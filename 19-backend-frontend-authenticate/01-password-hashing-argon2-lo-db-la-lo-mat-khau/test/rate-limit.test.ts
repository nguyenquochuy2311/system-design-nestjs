import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertWrappedUser, setupTestDb, startTestApp, type TestApp } from './support/test-app';

describe('Bộ đếm đăng nhập sai (Redis) — chặn thử mật khẩu online', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb());
  });
  afterAll(() => t.close());
  // Bộ đếm nằm trong Redis (dùng chung máy); xóa sạch trước mỗi test để đếm từ 0.
  beforeEach(() => t.redis.flushdb());

  it('sai 10 lần vẫn trả 401; lần thứ 11 bị chặn 429', async () => {
    await insertWrappedUser(t, 'brute@lab.example', 'đúng-mk');
    for (let i = 1; i <= 10; i++) {
      const res = await t.login('/sau/login', 'brute@lab.example', `sai-${i}`);
      expect(res.status, `lần sai thứ ${i}`).toBe(401);
    }
    const res11 = await t.login('/sau/login', 'brute@lab.example', 'sai-11');
    expect(res11.status).toBe(429);
    expect(res11.body.error).toBe('too_many_attempts');
    // Khi đã bị chặn, mật khẩu ĐÚNG cũng bị 429 (chặn trước khi băm, tiết kiệm CPU).
    expect((await t.login('/sau/login', 'brute@lab.example', 'đúng-mk')).status).toBe(429);
  });

  it('đăng nhập đúng reset bộ đếm sai', async () => {
    await insertWrappedUser(t, 'reset@lab.example', 'đúng-mk');
    for (let i = 1; i <= 5; i++) expect((await t.login('/sau/login', 'reset@lab.example', 'sai')).status).toBe(401);
    expect(Number(await t.redis.get('login:fail:email:reset@lab.example'))).toBe(5);
    expect((await t.login('/sau/login', 'reset@lab.example', 'đúng-mk')).status).toBe(200);
    // Sau khi đúng, bộ đếm theo email về 0 (key bị xóa).
    expect(await t.redis.get('login:fail:email:reset@lab.example')).toBeNull();
  });
});
