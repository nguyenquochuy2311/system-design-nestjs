import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { insertUser, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Bước 5 ý 3: request đổi dữ liệu thiếu/không hợp lệ token CSRF hoặc Origin lạ → 403; hợp lệ → 201/200.
describe('CSRF guard (bản sau): Origin + double-submit có ký', () => {
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

  it('POST thiếu header X-CSRF-Token → 403', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const r = await t.request('POST', '/sau/notes', { cookie: d.cookie, body: { body: '<b>x</b>' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('bad_csrf_token');
  });

  it('POST từ Origin lạ → 403 (dù có token)', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const r = await t.request('POST', '/sau/notes', { cookie: d.cookie, csrf: d.csrf, origin: 'http://evil.example', body: { body: 'x' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('bad_origin');
  });

  it('POST không có Origin lẫn Referer → 403', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const r = await t.request('POST', '/sau/notes', { cookie: d.cookie, csrf: d.csrf, origin: null, body: { body: 'x' } });
    expect(r.status).toBe(403);
  });

  it('token CSRF của phiên khác không dùng được cho phiên này → 403', async () => {
    const d1 = await t.loginSau('alice@crm.local', 'pw-alice');
    const d2 = await t.loginSau('alice@crm.local', 'pw-alice');
    // Gửi cookie của phiên 1 nhưng token (header + cookie csrf) của phiên 2.
    const mixedCookie = d1.cookie.replace(/csrf=[^;]+/, `csrf=${d2.csrf}`);
    const r = await t.request('POST', '/sau/notes', { cookie: mixedCookie, csrf: d2.csrf, body: { body: 'x' } });
    expect(r.status).toBe(403);
  });

  it('POST đủ Origin hợp lệ + token khớp → 201', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const r = await t.request('POST', '/sau/notes', { cookie: d.cookie, csrf: d.csrf, body: { body: '<img src=x onerror="/*lab*/">' } });
    expect(r.status).toBe(201);
  });

  it('đăng nhập từ Origin lạ → 403 (chặn login CSRF bằng Origin)', async () => {
    const r = await t.request('POST', '/sau/login', { origin: 'http://evil.example', body: { email: 'alice@crm.local', password: 'pw-alice' } });
    expect(r.status).toBe(403);
  });
});
