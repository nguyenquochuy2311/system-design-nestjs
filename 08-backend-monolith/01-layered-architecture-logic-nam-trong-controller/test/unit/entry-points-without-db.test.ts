import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORDER_UNIT_OF_WORK } from '../../src/sau/orders/application/order-repository';
import { OrdersModule } from '../../src/sau/orders/orders.module';
import { CsvImportJob } from '../../src/sau/orders/presentation/csv-import.job';
import { MarketplaceSyncJob } from '../../src/sau/orders/presentation/marketplace-sync.job';
import { MAILER, RecordingMailer } from '../../src/shared/mailer';
import { InMemoryOrderUnitOfWork } from '../support/in-memory-unit-of-work';

const uow = new InMemoryOrderUnitOfWork();

@Global()
@Module({ providers: [{ provide: MAILER, useClass: RecordingMailer }], exports: [MAILER] })
class TestMailerModule {}

let app: INestApplication;

beforeAll(async () => {
  // DI của NestJS: thay hiện thực Kysely bằng bản trong bộ nhớ; controller, job, service giữ nguyên.
  const moduleRef = await Test.createTestingModule({ imports: [TestMailerModule, OrdersModule] })
    .overrideProvider(ORDER_UNIT_OF_WORK)
    .useValue(uow)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(() => app.close());

function overLimitCustomer() {
  const customer = uow.addCustomer('gold', 100_000_000);
  uow.addUnpaidOrder(customer.id, 80_000_000);
  const product = uow.addProduct(1_000_000);
  return { customerId: customer.id, productId: product.id };
}

describe('sau: cả module NestJS chạy không cần DB nhờ thay repository qua DI', () => {
  it('web: đơn vượt hạn mức trả 422 kèm số còn thiếu', async () => {
    const { customerId, productId } = overLimitCustomer();
    const res = await request(app.getHttpServer()).post('/sau/orders').send({ customerId, items: [{ productId, quantity: 30 }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'credit_limit_exceeded', shortfall: 8_500_000 });
    expect(uow.ordersOf(customerId)).toHaveLength(1);
  });

  it('CSV: đơn vượt hạn mức vào báo cáo dòng lỗi, đơn hợp lệ cùng file vẫn được tạo', async () => {
    const over = overLimitCustomer();
    const ok = uow.addCustomer('silver', 10_000_000);
    const csv = ['order_ref,customer_id,product_id,quantity', `A-1,${over.customerId},${over.productId},30`, `A-2,${ok.id},${over.productId},2`].join('\n');
    const report = await app.get(CsvImportJob).run(csv);
    expect(report.failed).toEqual([{ ref: 'A-1', reason: 'Vượt hạn mức công nợ, còn thiếu 8500000 đồng' }]);
    expect(report.created).toEqual([expect.objectContaining({ ref: 'A-2', total: 1_960_000 })]);
  });

  it('sàn TMĐT: đơn vượt hạn mức (do công nợ đang có) bị từ chối', async () => {
    const { customerId, productId } = overLimitCustomer();
    const report = await app.get(MarketplaceSyncJob).run([{ marketplaceOrderId: 'SAN-9', customerId, lines: [{ productId, qty: 30 }] }]);
    expect(report.created).toHaveLength(0);
    expect(report.failed[0]?.reason).toContain('Vượt hạn mức công nợ');
  });

  it('body sai hình dạng trả 400, không chạm tới service', async () => {
    const committedBefore = uow.stats.committed + uow.stats.rolledBack;
    const res = await request(app.getHttpServer()).post('/sau/orders').send({ customerId: 1, items: [] });
    expect(res.status).toBe(400);
    expect(uow.stats.committed + uow.stats.rolledBack).toBe(committedBefore);
  });
});
