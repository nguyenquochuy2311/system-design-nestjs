// Hằng số và tiện ích dùng chung cho test và script đo: tên miền của hai site, gọi qua CDN bằng node:http,
// bật/tắt API như tiến trình riêng, mở Chrome hệ thống.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { LAB_DIR } from '../../scripts/build-release';
import { CDN_PORT } from '../../scripts/cdn';
import { API_PORTS } from '../../scripts/deploy';
import type { ReleaseId, Site } from '../../web/releases';

export { LAB_DIR };
export const CDN = `http://127.0.0.1:${CDN_PORT}`;
/** Chrome tự trỏ *.localhost về 127.0.0.1 (đã kiểm với Chrome 154), nên mỗi site là một origin riêng qua cùng CDN. */
export const siteOrigin = (site: Site) => `http://${site}.localhost:${CDN_PORT}`;
export const apiUrl = (site: Site) => `http://127.0.0.1:${API_PORTS[site]}`;
export const CHROME_ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  header: (name: string) => string | undefined;
  text: () => string;
}

/**
 * GET qua CDN bằng node:http, gửi đúng header được truyền (Host chọn site). Không dùng fetch() cho request có điều
 * kiện: undici tự thêm Cache-Control: no-cache khi tự đặt If-None-Match (nhật ký quyết định, bài 04/01).
 */
export function rawGet(site: Site, path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${CDN}${path}`, { method: 'GET', headers: { Host: `${site}.localhost:${CDN_PORT}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const h = res.headers;
        resolve({
          status: res.statusCode ?? 0,
          headers: h,
          body,
          header: (name) => {
            const v = h[name.toLowerCase()];
            return Array.isArray(v) ? v.join(', ') : v;
          },
          text: () => body.toString('utf8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Đường dẫn file tĩnh mà index.html trỏ tới (script, modulepreload, stylesheet). */
export function staticRefs(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const m = /(?:src|href)="(\/[^"]+\.(?:js|css))"/.exec(tag);
    if (m) out.add(m[1]!);
  }
  return [...out];
}

/** Manifest của Vite trong thư mục build: file của entry và chunk tải lười. */
export function manifestOf(buildDir: string): Record<string, { file: string; isEntry?: boolean; isDynamicEntry?: boolean; css?: string[] }> {
  return JSON.parse(readFileSync(join(buildDir, '.vite/manifest.json'), 'utf8')) as never;
}

export async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
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

export async function assertCdnUp(): Promise<void> {
  await waitHttp(`${CDN}/__cdn/health`, 3_000).catch(() => {
    throw new Error('CDN mô phỏng chưa chạy: docker compose up -d --wait');
  });
}

export interface Proc {
  child: ChildProcess;
  pid: number;
  stop: () => Promise<void>;
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', () => reject(new Error(`cổng ${port} đang bận: tắt tiến trình đang nghe (lsof -nP -iTCP:${port} -sTCP:LISTEN) rồi chạy lại`)));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

/** API NestJS (src/main.ts) của một site như tiến trình riêng — giống `pnpm api`, là máy gốc của /api/. */
export async function startApi(site: Site, release: ReleaseId = '41', env: Record<string, string> = {}, logFd?: number): Promise<Proc> {
  const port = API_PORTS[site];
  await assertPortFree(port);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: LAB_DIR,
    env: { ...process.env, SITE: site, PORT: String(port), RELEASE: release, ...env },
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
    await waitHttp(`http://127.0.0.1:${port}/ops/health`);
  } catch (e) {
    await stop();
    throw e;
  }
  return { child, pid: child.pid!, stop };
}

export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Google Chrome đã cài trên máy, headless, profile tạm của Playwright (không đụng Chrome của người dùng). */
export const launchChrome = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: true });

/** Người dùng giả lập: một browser context (cache riêng) có cookie uid để API và CDN ghi log theo người dùng. */
export async function newUser(browser: Browser, site: Site, uid: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'uid', value: uid, url: siteOrigin(site) }]);
  return ctx;
}

export interface TabWatch {
  page: Page;
  pageErrors: string[];
  failed: { status: number; url: string }[];
  loads: number;
}

/** Mở một tab và ghi lại lỗi JS (pageerror), response lỗi và số lần tải trang đầy đủ. */
export async function openTab(ctx: BrowserContext, site: Site, path: string): Promise<TabWatch> {
  const page = await ctx.newPage();
  const watch: TabWatch = { page, pageErrors: [], failed: [], loads: 0 };
  page.on('pageerror', (e) => watch.pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) watch.failed.push({ status: r.status(), url: r.url() });
  });
  page.on('load', () => watch.loads++);
  await page.goto(`${siteOrigin(site)}${path}`, { waitUntil: 'load' });
  return watch;
}

export const runningVersion = (page: Page) => page.evaluate(() => window.__APP__?.version ?? null);
