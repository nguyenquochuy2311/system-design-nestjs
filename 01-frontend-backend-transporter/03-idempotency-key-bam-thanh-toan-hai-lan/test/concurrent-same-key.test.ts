import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL } from '../src/shared/db';
import { requestFingerprint } from '../src/sau/idempotency/request-fingerprint';
import { balanceOf, paymentsByNote, setupTestDb, startTestApp, TEST_SCHEMA, type TestApp } from './support/test-app';

// (c) Request trùng đến khi lần đầu còn đang xử lý, và 20 request đồng thời cùng khóa.
describe('(c) request trùng đồng thời', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 10_000_000, '2': 10_000_000, '3': 10_000_000, '4': 10_000_000 }));
  });
  afterAll(() => t.close());

  const fire20 = (path: string, userId: string, key: string, body: unknown) =>
    Promise.all(Array.from({ length: 20 }, () => t.post(path, { userId, key, body })));

  it('bản trước: 20 request giống nhau cùng lúc tạo 20 giao dịch', async () => {
    const note = `c-truoc-${randomUUID()}`;
    const replies = await fire20('/truoc/payments', '1', randomUUID(), { merchantId: 7, amount: 10_000, note });
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(await paymentsByNote(t.db, note)).toHaveLength(20);
    expect(await balanceOf(t.db, '1')).toBe(10_000_000 - 20 * 10_000);
  });

  it('bản sau: 20 request cùng khóa cùng lúc chỉ tạo đúng một giao dịch; các request còn lại nhận 409 hoặc bản phát lại', async () => {
    const note = `c-sau-${randomUUID()}`;
    const replies = await fire20('/sau/payments', '2', randomUUID(), { merchantId: 7, amount: 10_000, note });
    const payments = await paymentsByNote(t.db, note);
    expect(payments).toHaveLength(1);
    expect(await balanceOf(t.db, '2')).toBe(10_000_000 - 10_000);
    const ok = replies.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(replies.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    // Mọi response 201 (lần đầu và các bản phát lại) mang đúng payment đã ghi.
    expect(new Set(ok.map((r) => r.body)).size).toBe(1);
    expect(JSON.parse(ok[0]!.body).paymentId).toBe(payments[0]!.id);
  });

  it('request trùng khi lần đầu còn "processing" bị báo 409, sau khi lần đầu xong thì nhận bản phát lại', async () => {
    const note = `c-processing-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 10_000, note };
    // Giữ khóa dòng ví của user 3 từ một kết nối khác: request đầu sẽ đứng ở bước trừ tiền, khóa ở trạng thái processing.
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query("SELECT 1 FROM wallets WHERE user_id = 3 FOR UPDATE");
    try {
      const firstPromise = t.post('/sau/payments', { userId: '3', key, body });
      for (let i = 0; i < 100; i++) {
        const row = await t.db.selectFrom('idempotency_keys').select('status').where('idempotency_key', '=', key).executeTakeFirst();
        if (row?.status === 'processing') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const duplicate = await t.post('/sau/payments', { userId: '3', key, body });
      expect(duplicate.status).toBe(409);
      expect(duplicate.headers['retry-after']).toBe('1');
      expect(JSON.parse(duplicate.body).error).toBe('idempotency_key_in_use');
      await blocker.query('COMMIT');
      const first = await firstPromise;
      expect(first.status).toBe(201);
      const later = await t.post('/sau/payments', { userId: '3', key, body });
      expect(later.status).toBe(201);
      expect(later.body).toBe(first.body);
      expect(later.headers['idempotent-replayed']).toBe('true');
      expect(await paymentsByNote(t.db, note)).toHaveLength(1);
    } finally {
      await blocker.end();
    }
  });

  it('khóa kẹt ở "processing" quá thời gian khóa (tiến trình trước đã chết) được request sau tiếp quản', async () => {
    const note = `c-ket-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 10_000, note };
    await t.db
      .insertInto('idempotency_keys')
      .values({
        user_id: '4', idempotency_key: key, request_method: 'POST', request_path: '/sau/payments',
        fingerprint: requestFingerprint('POST', '/sau/payments', body), locked_at: sql<Date>`now() - interval '1 hour'`,
      })
      .execute();
    const res = await t.post('/sau/payments', { userId: '4', key, body });
    expect(res.status).toBe(201);
    expect(await paymentsByNote(t.db, note)).toHaveLength(1);
  });
});
