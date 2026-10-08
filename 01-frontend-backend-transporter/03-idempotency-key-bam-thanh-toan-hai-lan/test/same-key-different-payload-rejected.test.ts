import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, paymentsByNote, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// (b) Cùng khóa nhưng payload khác là lỗi của client: từ chối, không im lặng trả kết quả cũ.
describe('(b) cùng khóa khác payload', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 1_000_000 }));
  });
  afterAll(() => t.close());

  it('cùng khóa khác số tiền bị từ chối 422, không tạo giao dịch thứ hai', async () => {
    const note = `b-${randomUUID()}`;
    const key = randomUUID();
    const first = await t.post('/sau/payments', { userId: '1', key, body: { merchantId: 7, amount: 50_000, note } });
    const second = await t.post('/sau/payments', { userId: '1', key, body: { merchantId: 7, amount: 90_000, note } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
    expect(JSON.parse(second.body).error).toBe('idempotency_key_reused');
    expect(await paymentsByNote(t.db, note)).toHaveLength(1);
    expect(await balanceOf(t.db, '1')).toBe(950_000);
  });

  it('cùng payload nhưng đổi thứ tự trường vẫn là cùng một request (phát lại)', async () => {
    const note = `b-thu-tu-${randomUUID()}`;
    const key = randomUUID();
    const first = await t.post('/sau/payments', { userId: '1', key, body: { merchantId: 7, amount: 10_000, note } });
    const second = await t.post('/sau/payments', { userId: '1', key, body: { note, amount: 10_000, merchantId: 7 } });
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toBe(first.body);
    expect(await paymentsByNote(t.db, note)).toHaveLength(1);
  });
});
