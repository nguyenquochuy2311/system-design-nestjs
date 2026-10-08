// Tiện ích dùng chung cho test và script đo: cổng, build Next có cache theo hash mã nguồn, bật/tắt API và Next như
// tiến trình riêng, mở Google Chrome hệ thống (headless, profile tạm), gọi route /ops của API.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Change, HistoryDump } from '../../src/shared/orders.store';
import type { RequestLine } from '../../src/shared/request-log';
import { filtersToQuery, type OrderFilters, type OrderRow, type OrderStatus } from '../../web/orders/contracts';
import type { LabEvent } from '../../web/orders/lab-types';

export const LAB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const API_PORT = 3100;
export const WEB_PORT = 3200;
export const API = `http://127.0.0.1:${API_PORT}`;
export const WEB = `http://127.0.0.1:${WEB_PORT}`;
export type Variant = 'truoc' | 'sau';

// ---------- build ----------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // next-env.d.ts do next build tự ghi lại (nội dung theo distDir): không phải mã nguồn, tính vào hash thì build thừa.
    if (name === 'node_modules' || name.startsWith('.next') || name === 'next-env.d.ts') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else out.push(p);
  }
  return out.sort();
}

/** Hash mã nguồn của web/ (kể cả next.config.ts) + chế độ build: đổi một dòng là build lại (phép thử âm sửa web/). */
export function webSourceHash(cacheComponents: boolean): string {
  const h = createHash('sha256').update(cacheComponents ? 'cc' : 'default');
  for (const f of sourceFiles(join(LAB_DIR, 'web'))) h.update(relative(LAB_DIR, f)).update(readFileSync(f));
  return h.digest('hex').slice(0, 16);
}

export const distDirOf = (cacheComponents: boolean) => join(LAB_DIR, 'web', cacheComponents ? '.next-cache-components' : '.next');

/** `next build web` nếu bản build hiện có không khớp mã nguồn. Ép NODE_ENV=production (Vitest đặt NODE_ENV=test). */
export function ensureWebBuild(cacheComponents = false): { hash: string; built: boolean; seconds: number } {
  const hash = webSourceHash(cacheComponents);
  const marker = join(distDirOf(cacheComponents), 'lab-source-hash');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === hash) return { hash, built: false, seconds: 0 };
  const started = Date.now();
  const res = spawnSync(process.execPath, [join(LAB_DIR, 'node_modules/next/dist/bin/next'), 'build', 'web'], {
    cwd: LAB_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', LAB_CACHE_COMPONENTS: cacheComponents ? '1' : '' },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`next build thất bại (mã ${res.status}):\n${res.stdout}\n${res.stderr}`);
  writeFileSync(marker, hash);
  return { hash, built: true, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

// ---------- tiến trình ----------

export interface Proc {
  child: ChildProcess;
  pid: number;
  stop: () => Promise<void>;
}

export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', () => reject(new Error(`cổng ${port} đang bận: tắt tiến trình đang nghe (lsof -nP -iTCP:${port} -sTCP:LISTEN) rồi chạy lại`)));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

export async function waitHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // chưa lên
    }
    if (Date.now() > deadline) throw new Error(`không gọi được ${url}`);
    await sleep(150);
  }
}

async function startProcess(args: string[], port: number, healthUrl: string, env: Record<string, string>, logFd?: number): Promise<Proc> {
  await assertPortFree(port);
  const child = spawn(process.execPath, args, {
    cwd: LAB_DIR,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'inherit'],
  });
  const kill = () => child.kill('SIGKILL');
  process.once('exit', kill);
  const stop = async () => {
    process.off('exit', kill);
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(5_000).then(() => child.kill('SIGKILL'))]);
  };
  try {
    await waitHttp(healthUrl);
  } catch (e) {
    await stop();
    throw e;
  }
  return { child, pid: child.pid!, stop };
}

/** API NestJS (src/main.ts) như tiến trình riêng — giống `pnpm api`. */
export const startApi = (env: Record<string, string> = {}, logFd?: number) =>
  startProcess(['--import', 'tsx', 'src/main.ts'], API_PORT, `${API}/ops/health`, { PORT: String(API_PORT), ...env }, logFd);

/** Next.js production (`next start web`) — giống `pnpm web`; cần build trước (ensureWebBuild). */
export const startWeb = (opts: { cacheComponents?: boolean } = {}, logFd?: number) =>
  startProcess(
    [join(LAB_DIR, 'node_modules/next/dist/bin/next'), 'start', 'web', '--port', String(WEB_PORT), '--hostname', '127.0.0.1'],
    WEB_PORT,
    `${WEB}/healthz`,
    { NODE_ENV: 'production', LAB_CACHE_COMPONENTS: opts.cacheComponents ? '1' : '' },
    logFd,
  );

// ---------- API /ops ----------

async function ops<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const resetApi = (seed = 42) => ops<{ t0: number }>('/ops/reset', { seed });
export const changeOrder = (id: string, patch: { status?: OrderStatus; assignee?: string | null }) => ops<Change>(`/ops/orders/${id}/change`, patch);
export const createOrder = (region: string) => ops<Change>(`/ops/regions/${region}/orders`, {});
export const othersTick = (region: string) => ops<{ change: Change | null }>(`/ops/regions/${region}/others-tick`, {});
export const truth = (uid: string, f: OrderFilters) => ops<{ items: OrderRow[]; total: number; seq: number; region: string }>(`/ops/truth?uid=${uid}&${filtersToQuery(f)}`);
export const requestsSince = (since: number, uid?: string) => ops<RequestLine[]>(`/ops/requests?since=${since}${uid ? `&uid=${uid}` : ''}`);
export const history = () => ops<HistoryDump>('/ops/history');

// ---------- trình duyệt ----------

/** Google Chrome đã cài trên máy, headless, profile tạm của Playwright (không đụng Chrome của người dùng). */
export const launchChrome = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: true });

/**
 * Context mới (cache, cookie riêng). Script đo chạy bằng tsx: esbuild bật keepNames và chèn __name(...) quanh các hàm có
 * tên bên trong callback của page.evaluate; trang không có hàm đó (ReferenceError). Init script định nghĩa nó.
 */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: 'globalThis.__name ??= (f) => f;' });
  return ctx;
}

/** Một điều phối viên: browser context riêng (cache, cookie riêng), đã có cookie uid như sau khi đăng nhập. */
export async function newDispatcher(browser: Browser, uid: string, cookies: Record<string, string> = {}): Promise<BrowserContext> {
  const ctx = await newContext(browser);
  await ctx.addCookies([{ name: 'uid', value: uid, url: WEB }, ...Object.entries(cookies).map(([name, value]) => ({ name, value, url: WEB }))]);
  return ctx;
}

export const listUrl = (variant: Variant | 'rsc', f: Partial<OrderFilters> = {}) =>
  `${WEB}/${variant}/orders?${filtersToQuery({ status: 'moi', warehouse: 'tat-ca', page: 1, ...f })}`;

/** Chờ danh sách hiện dữ liệu và không còn request nền (bảng có hàng, không vòng xoay, không "Đang cập nhật"). */
export async function waitListSettled(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => {
      // Chỉ phần tử đang hiện (Cache Components giữ trang cũ trong DOM, ẩn bằng display: none).
      const shown = (sel: string) => [...document.querySelectorAll(sel)].some((el) => el.checkVisibility());
      return shown('[data-testid="order-row"]') && !shown('[data-testid="list-loading"]') && !shown('[data-testid="list-refreshing"]');
    },
    undefined,
    { timeout: timeoutMs, polling: 50 },
  );
}

export const tableState = (page: Page) =>
  page.evaluate(() => {
    const t = [...document.querySelectorAll<HTMLElement>('[data-testid="order-table"]')].find((el) => el.checkVisibility());
    return t
      ? {
          generatedAt: Number(t.dataset.generatedAt),
          seq: Number(t.dataset.seq),
          filters: t.dataset.filters ?? '',
          placeholder: t.dataset.placeholder === '1',
          rows: [...t.querySelectorAll<HTMLElement>('[data-testid="order-row"]')].map((r) => ({ id: r.dataset.id ?? '', status: r.dataset.status ?? '' })),
        }
      : null;
  });

/** Lấy và xóa các sự kiện bộ đo đã ghi trong trang. */
export const drainEvents = (page: Page) => page.evaluate(() => (window.__LAB__?.events ?? []).splice(0)) as Promise<LabEvent[]>;
export const peekEvents = (page: Page) => page.evaluate(() => [...(window.__LAB__?.events ?? [])]) as Promise<LabEvent[]>;

export const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
