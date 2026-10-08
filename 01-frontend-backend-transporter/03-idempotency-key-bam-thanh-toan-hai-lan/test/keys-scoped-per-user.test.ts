import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, paymentsByNote, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// (d) Khóa thuộc về người dùng: hai người dùng tình cờ trùng khóa không ảnh hưởng nhau.
describe('(d) khóa theo người dùng', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb({ '10': 1_000_000, '20': 1_000_000 }));
  });
  afterAll(() => t.close());

  it('khóa của người dùng A không ảnh hưởng người dùng B dù cùng chuỗi khóa và cùng payload', async () => {
    const note = `d-${randomUUID()}`;
    const key = randomUUID();
    const body = { merchantId: 7, amount: 50_000, note };
    const a = await t.post('/sau/payments', { userId: '10', key, body });
    const b = await t.post('/sau/payments', { userId: '20', key, body });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(JSON.parse(a.body).userId).toBe('10');
    expect(JSON.parse(b.body).userId).toBe('20');
    const payments = await paymentsByNote(t.db, note);
    expect(payments.map((p) => p.user_id).sort()).toEqual(['10', '20']);
    expect(await balanceOf(t.db, '10')).toBe(950_000);
    expect(await balanceOf(t.db, '20')).toBe(950_000);
    // Gửi lại của A nhận đúng payment của A.
    const aAgain = await t.post('/sau/payments', { userId: '10', key, body });
    expect(aAgain.body).toBe(a.body);
  });
});
