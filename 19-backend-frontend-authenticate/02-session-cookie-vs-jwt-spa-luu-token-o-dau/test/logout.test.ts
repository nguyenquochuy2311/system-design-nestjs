import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { insertUser, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Bước 5 ý 2 + kiểm Redis: đăng xuất rồi phát lại cookie cũ → 401; key phiên thật sự biến mất khỏi Redis.
describe('Đăng xuất hủy phiên (bản sau)', () => {
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

  it('đăng xuất rồi phát lại cookie cũ nhận 401, và Redis không còn bản ghi phiên đó', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    expect((await t.request('GET', '/sau/me', { cookie: d.cookie })).status).toBe(200);
    expect((await t.sessKeys()).length).toBe(1);

    const out = await t.request('POST', '/sau/logout', { cookie: d.cookie, csrf: d.csrf });
    expect(out.status).toBe(200);

    expect((await t.request('GET', '/sau/me', { cookie: d.cookie })).status).toBe(401);
    expect(await t.sessKeys()).toEqual([]);
    expect(await t.userSessions(aliceId)).toEqual([]);
  });
});
