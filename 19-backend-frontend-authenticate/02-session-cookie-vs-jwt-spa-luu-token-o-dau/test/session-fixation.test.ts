import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { cookieValue, insertUser, rawSessionId, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Bước 5 ý 4: id phiên đổi sau đăng nhập (chống session fixation); id cũ không còn trong Redis.
describe('Chống session fixation: tạo id mới khi đăng nhập (bản sau)', () => {
  let db: Pool;
  let t: TestApp;

  beforeAll(async () => {
    db = await setupTestDb();
    t = await startTestApp(db);
  });
  afterAll(async () => {
    await t.close(); // app.close() đã kết thúc pool DB và ngắt Redis (ConnectionCloser)
  });
  beforeEach(async () => {
    await t.redis.flushdb();
    await db.query('DELETE FROM notes');
    await db.query('DELETE FROM users');
    await insertUser(db, { email: 'alice@crm.local', displayName: 'Alice', password: 'pw-alice' });
  });

  it('đăng nhập lại trên cùng cookie sinh id MỚI; id cũ bị xóa khỏi Redis', async () => {
    const first = await t.loginSau('alice@crm.local', 'pw-alice');
    const sid1 = rawSessionId(cookieValue(first.reply.setCookies, t.config.cookieName)!);
    expect((await t.sessKeys()).sort()).toEqual([`sess:${sid1}`]);

    // Mang theo cookie phiên cũ (đã đăng nhập) rồi đăng nhập tiếp — kèm token CSRF hợp lệ của phiên đó: server regenerate → id mới.
    const second = await t.request('POST', '/sau/login', { cookie: first.cookie, csrf: first.csrf, body: { email: 'alice@crm.local', password: 'pw-alice' } });
    const sid2 = rawSessionId(cookieValue(second.setCookies, t.config.cookieName)!);

    expect(sid2).toBeTruthy();
    expect(sid2).not.toBe(sid1); // id đổi sau đăng nhập
    const keys = await t.sessKeys();
    expect(keys).toContain(`sess:${sid2}`);
    expect(keys).not.toContain(`sess:${sid1}`); // id cũ không còn trong Redis
  });
});
