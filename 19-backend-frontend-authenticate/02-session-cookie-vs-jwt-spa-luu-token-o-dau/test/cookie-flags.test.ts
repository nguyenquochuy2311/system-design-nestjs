import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { insertUser, setupTestDb, startTestApp, type TestApp } from './support/test-app';

// Cờ cookie đạt khuyến nghị OWASP + RFC 6265bis (tiền tố __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, không Domain).
// Phép thử âm: bỏ HttpOnly → cookie phiên lọt vào document.cookie (XSS đọc được) → test HttpOnly dưới đây đỏ.
function parse(setCookie: string): { name: string; attrs: Record<string, string>; flags: Set<string> } {
  const parts = setCookie.split(';').map((p) => p.trim());
  const [name] = parts[0]!.split('=');
  const attrs: Record<string, string> = {};
  const flags = new Set<string>();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) flags.add(p.toLowerCase());
    else attrs[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1);
  }
  return { name: name!, attrs, flags };
}

describe('Cờ cookie phiên (bản sau)', () => {
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
    await db.query('DELETE FROM users');
    await insertUser(db, { email: 'alice@crm.local', displayName: 'Alice', password: 'pw-alice' });
  });

  it('cookie phiên: tên __Host-sid, HttpOnly, Secure, SameSite=Lax, Path=/, không Domain', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const raw = d.reply.setCookies.find((c) => c.startsWith('__Host-sid='));
    expect(raw).toBeTruthy();
    const c = parse(raw!);
    expect(c.name).toBe('__Host-sid');
    expect(c.name.startsWith('__Host-')).toBe(true);
    expect(c.flags.has('httponly')).toBe(true); // JS KHÔNG đọc được → XSS không mang phiên đi được
    expect(c.flags.has('secure')).toBe(true);
    expect(c.attrs['samesite']?.toLowerCase()).toBe('lax');
    expect(c.attrs['path']).toBe('/');
    expect('domain' in c.attrs).toBe(false); // __Host- buộc không có Domain
  });

  it('cookie csrf: đọc được bằng JS (không HttpOnly) nhưng vẫn Secure — phục vụ double-submit', async () => {
    const d = await t.loginSau('alice@crm.local', 'pw-alice');
    const raw = d.reply.setCookies.find((c) => c.startsWith('csrf='));
    const c = parse(raw!);
    expect(c.flags.has('httponly')).toBe(false);
    expect(c.flags.has('secure')).toBe(true);
    expect(c.attrs['samesite']?.toLowerCase()).toBe('lax');
  });
});
