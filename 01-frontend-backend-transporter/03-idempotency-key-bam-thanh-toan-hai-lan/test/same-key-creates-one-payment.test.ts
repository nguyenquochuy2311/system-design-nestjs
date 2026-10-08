import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, paymentsByNote, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// (a) Gửi lại cùng Idempotency-Key: một giao dịch, response y hệt lần đầu.
describe('(a) hai request cùng khóa', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '1': 1_000_000, '2': 1_000_000, '3': 30_000 }));
  });
  afterAll(() => t.close());

  it('bản trước: gửi lại cùng một ý định tạo hai giao dịch và trừ tiền hai lần', async () => {
    const note = `a-truoc-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 50_000, note };
    const first = await t.post('/truoc/payments', { userId: '1', key, body });
    const second = await t.post('/truoc/payments', { userId: '1', key, body });
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(JSON.parse(first.body).paymentId).not.toBe(JSON.parse(second.body).paymentId);
    expect(await paymentsByNote(t.db, note)).toHaveLength(2);
    expect(await balanceOf(t.db, '1')).toBe(900_000);
  });

  it('bản sau: hai request cùng khóa chỉ tạo một giao dịch và nhận cùng response (so từng byte)', async () => {
    const note = `a-sau-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 50_000, note };
    const first = await t.post('/sau/payments', { userId: '2', key, body });
    const second = await t.post('/sau/payments', { userId: '2', key, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(first.status);
    expect(Buffer.from(second.body).equals(Buffer.from(first.body))).toBe(true);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    const payments = await paymentsByNote(t.db, note);
    expect(payments.map((p) => p.id)).toEqual([JSON.parse(first.body).paymentId]);
    expect(await balanceOf(t.db, '2')).toBe(950_000);
  });

  it('kết quả lỗi nghiệp vụ cũng được lưu: gửi lại sau khi nạp tiền vẫn nhận đúng lỗi cũ, không trừ tiền', async () => {
    const note = `a-loi-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 50_000, note };
    const first = await t.post('/sau/payments', { userId: '3', key, body });
    expect(first.status).toBe(402);
    await t.db.updateTable('wallets').set({ balance: 1_000_000 }).where('user_id', '=', '3').execute();
    const second = await t.post('/sau/payments', { userId: '3', key, body });
    expect(second.status).toBe(402);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await paymentsByNote(t.db, note)).toHaveLength(0);
    // Ý định mới (khóa mới) thì chạy lại nghiệp vụ.
    expect((await t.post('/sau/payments', { userId: '3', key: randomUUID(), body })).status).toBe(201);
  });

  it('thiếu Idempotency-Key ở endpoint bắt buộc: 400, không trừ tiền', async () => {
    const note = `a-thieu-${randomUUID()}`;
    const res = await t.post('/sau/payments', { userId: '2', body: { merchantId: 7, amount: 1_000, note } });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('idempotency_key_required');
    expect(await paymentsByNote(t.db, note)).toHaveLength(0);
  });

  it('lỗi validate không được lưu: sửa payload rồi gửi lại cùng khóa thì xử lý bình thường', async () => {
    const note = `a-validate-${randomUUID()}`;
    const key = randomUUID();
    const bad = await t.post('/sau/payments', { userId: '2', key, body: { merchantId: 7, amount: -5, note } });
    expect(bad.status).toBe(400);
    const good = await t.post('/sau/payments', { userId: '2', key, body: { merchantId: 7, amount: 5_000, note } });
    expect(good.status).toBe(201);
    expect(good.headers['idempotent-replayed']).toBeUndefined();
    expect(await paymentsByNote(t.db, note)).toHaveLength(1);
  });
});
