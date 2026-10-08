import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql, type Kysely } from 'kysely';
import { AppModule } from '../../src/app.module';
import { createDb, KYSELY, type Database } from '../../src/shared/db';
import { postJson, type HttpReply } from '../../src/shared/payment-client';
import { IDEMPOTENCY_OPTIONS, type IdempotencyOptions } from '../../src/sau/idempotency/idempotency.options';

export const TEST_SCHEMA = 'lab_test';
const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');

/** Dựng lại schema `lab_test` từ db/schema.sql (file không ghi tên schema), kèm vài ví có số dư biết trước. */
export async function setupTestDb(wallets: Record<string, number>): Promise<Kysely<Database>> {
  const admin = createDb({ max: 1 });
  await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA}`).execute(admin);
  await admin.destroy();
  const db = createDb({ schema: TEST_SCHEMA, max: 20 });
  await sql.raw(readFileSync(resolve(DB_DIR, 'schema.sql'), 'utf8')).execute(db);
  await db.insertInto('wallets').values(Object.entries(wallets).map(([user_id, balance]) => ({ user_id, balance }))).execute();
  return db;
}

export interface TestApp {
  app: INestApplication;
  db: Kysely<Database>;
  port: number;
  url: string;
  /** Gửi POST tới `/truoc/payments` hoặc `/sau/payments` của app này. */
  post(path: string, req: { userId: string; key?: string; body: unknown }): Promise<HttpReply>;
  close(): Promise<void>;
}

/** App NestJS đầy đủ (cả hai bản) trên schema test, nghe một cổng thật để đi được qua Toxiproxy. */
export async function startTestApp(db: Kysely<Database>, options: Partial<IdempotencyOptions> = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KYSELY)
    .useValue(db)
    .overrideProvider(IDEMPOTENCY_OPTIONS)
    .useValue({ lockTimeoutMs: 30_000, retentionHours: 24, cleanupIntervalMs: 0, ...options })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    db,
    port,
    url,
    post: (path, { userId, key, body }) =>
      postJson(`${url}${path}`, { 'X-User-Id': userId, ...(key ? { 'Idempotency-Key': `"${key}"` } : {}) }, body, 10_000),
    // Đóng app là đóng luôn pool Kysely (DatabaseCloser).
    close: () => app.close(),
  };
}

export async function paymentsByNote(db: Kysely<Database>, note: string) {
  return db.selectFrom('payments').select(['id', 'user_id', 'amount']).where('note', '=', note).orderBy('id').execute();
}

export async function balanceOf(db: Kysely<Database>, userId: string): Promise<number> {
  const row = await db.selectFrom('wallets').select('balance').where('user_id', '=', userId).executeTakeFirstOrThrow();
  return Number(row.balance);
}
