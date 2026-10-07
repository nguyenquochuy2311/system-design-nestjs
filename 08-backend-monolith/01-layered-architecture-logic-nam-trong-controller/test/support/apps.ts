import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { createDb, KYSELY } from '../../src/shared/db';
import { MAILER, type RecordingMailer } from '../../src/shared/mailer';
import { CsvImportJob as SauCsvImportJob } from '../../src/sau/orders/presentation/csv-import.job';
import { MarketplaceSyncJob as SauMarketplaceSyncJob } from '../../src/sau/orders/presentation/marketplace-sync.job';
import { CsvImportJob as TruocCsvImportJob } from '../../src/truoc/csv-import.job';
import { MarketplaceSyncJob as TruocMarketplaceSyncJob } from '../../src/truoc/marketplace-sync.job';
import type { ImportReport } from '../../src/shared/order-input';

export type Variant = 'truoc' | 'sau';
export type EntryPoint = 'web' | 'csv' | 'marketplace';
export const VARIANTS: Variant[] = ['truoc', 'sau'];
export const ENTRY_POINTS: EntryPoint[] = ['web', 'csv', 'marketplace'];

/** App NestJS đầy đủ (cả hai bản) trên PostgreSQL thật; `onQuery` để đếm câu SQL. */
export async function startApp(onQuery?: (sql: string) => void) {
  const db = createDb({ onQuery });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(KYSELY).useValue(db).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, db, mailer: app.get<RecordingMailer>(MAILER) };
}

export type OrderOutcome =
  | { accepted: true; orderId: number; total: number; body?: unknown }
  | { accepted: false; reason: string; status?: number; body?: unknown };

/** Đặt một đơn qua đường vào chỉ định, quy kết quả về "nhận / từ chối" để so giữa các đường vào. */
export async function placeVia(
  app: INestApplication,
  variant: Variant,
  entry: EntryPoint,
  customerId: number,
  items: { productId: number; quantity: number }[],
): Promise<OrderOutcome> {
  const ref = `REF-${entry}-${customerId}-${Date.now()}`;
  if (entry === 'web') {
    const res = await request(app.getHttpServer()).post(`/${variant}/orders`).send({ customerId, items });
    if (res.status === 201) return { accepted: true, orderId: res.body.orderId, total: res.body.total, body: res.body };
    return { accepted: false, reason: res.body.message, status: res.status, body: res.body };
  }
  let report: ImportReport;
  if (entry === 'csv') {
    const csv = ['order_ref,customer_id,product_id,quantity', ...items.map((i) => `${ref},${customerId},${i.productId},${i.quantity}`)].join('\n');
    const job = app.get(variant === 'truoc' ? TruocCsvImportJob : SauCsvImportJob);
    report = await job.run(csv);
  } else {
    const feed = [{ marketplaceOrderId: ref, customerId, lines: items.map((i) => ({ productId: i.productId, qty: i.quantity })) }];
    const job = app.get(variant === 'truoc' ? TruocMarketplaceSyncJob : SauMarketplaceSyncJob);
    report = await job.run(feed);
  }
  const created = report.created[0];
  if (created) return { accepted: true, orderId: created.orderId, total: created.total };
  return { accepted: false, reason: report.failed[0]?.reason ?? 'không rõ' };
}
