import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { insertUser, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Bước 5 ý 1 + kiểm ở mức Redis: khóa user xóa MỌI phiên; request kế 401; key phiên thật sự biến mất khỏi Redis.
// Phép thử âm: revoker không xóa tập phiên theo user → test này đỏ.
describe('Khóa tài khoản thu hồi mọi phiên (bản sau) — và tương phản với JWT bản trước', () => {
  let db: Pool;
  let t: TestApp;
  let aliceId: string;

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
    aliceId = await insertUser(db, { email: 'alice@crm.local', displayName: 'Alice', password: 'pw-alice' });
  });

  it('khóa user: hai phiên (hai thiết bị) cùng 401 ở request kế, Redis không còn key phiên của user', async () => {
    const d1 = await t.loginSau('alice@crm.local', 'pw-alice');
    const d2 = await t.loginSau('alice@crm.local', 'pw-alice');
    expect(d1.reply.status).toBe(200);
    expect((await t.userSessions(aliceId)).length).toBe(2);
    expect((await t.sessKeys()).length).toBe(2);

    const lock = await t.request('POST', '/sau/admin/lock', { cookie: d1.cookie, csrf: d1.csrf, body: { email: 'alice@crm.local' } });
    expect(lock.status).toBe(200);
    expect(lock.json.revoked).toBe(2);

    // Request kế của cả hai phiên: 401 ngay.
    expect((await t.request('GET', '/sau/me', { cookie: d1.cookie })).status).toBe(401);
    expect((await t.request('GET', '/sau/me', { cookie: d2.cookie })).status).toBe(401);

    // Bất biến ở mức lưu trữ: không còn bản ghi phiên nào và tập phiên theo user đã xóa.
    expect(await t.sessKeys()).toEqual([]);
    expect(await t.userSessions(aliceId)).toEqual([]);
  });

  it('tương phản bản trước: JWT vẫn hợp lệ sau khi khóa user (không thu hồi được)', async () => {
    const login = await t.request('POST', '/truoc/login', { body: { email: 'alice@crm.local', password: 'pw-alice' } });
    const token = login.json.token as string;
    await db.query('UPDATE users SET locked = TRUE WHERE id = $1', [aliceId]); // khóa trong DB
    const me = await t.request('GET', '/truoc/me', { bearer: token });
    expect(me.status).toBe(200); // token tự chứa, không tra DB → vẫn dùng được tới khi hết hạn
  });
});
