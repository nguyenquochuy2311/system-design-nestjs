// Hằng số và tiện ích dùng chung cho test và script đo: cổng, cookie phiên, bật/tắt máy gốc như tiến trình riêng.
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../../src/app';
import { loadConfig, type CacheMode } from '../../src/shared/config';
import { SESSION_COOKIE, sessionToken } from '../../src/shared/session';

export const CDN = 'http://127.0.0.1:58088';
export const API_PORT = 3100;
export const WEB_PORT = 3200;
export const SECRET = 'lab-only-session-secret';
export const ADMIN_TOKEN = 'lab-only-admin-token';
/** Header Accept của Chrome cho thẻ <img> và cho request tài liệu. */
export const CHROME_IMG_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
export const CHROME_ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

export const sessionCookie = (userId: number) => `${SESSION_COOKIE}=${sessionToken(SECRET, userId)}`;

/** App NestJS trong cùng tiến trình test (supertest), cho test chỉ cần header của máy gốc. */
export async function inProcessApi(mode: CacheMode): Promise<NestExpressApplication> {
  const app = await createApp(loadConfig({ ...process.env, CACHE_MODE: mode, SESSION_SECRET: SECRET, ADMIN_TOKEN, ACCESS_LOG: '' }));
  await app.init();
  return app;
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

async function startProcess(args: string[], port: number, healthPath: string, env: Record<string, string>, logFd?: number): Promise<Proc> {
  await assertPortFree(port);
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
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
    await waitHttp(`http://127.0.0.1:${port}${healthPath}`);
  } catch (e) {
    await stop();
    throw e;
  }
  return { child, pid: child.pid!, stop };
}

/** API NestJS (src/main.ts) như một tiến trình riêng — giống `pnpm api`, là máy gốc mà CDN gọi tới. */
export const startApi = (mode: CacheMode, port = API_PORT, env: Record<string, string> = {}, logFd?: number) =>
  startProcess(['src/main.ts'], port, '/ops/health', { CACHE_MODE: mode, PORT: String(port), SESSION_SECRET: SECRET, ADMIN_TOKEN, ...env }, logFd);

/** Trang Next.js production qua custom server (web/server.ts); cần `pnpm web:build` trước. */
export const startWeb = (mode: CacheMode, port = WEB_PORT, env: Record<string, string> = {}, logFd?: number) =>
  startProcess(['web/server.ts'], port, '/__ops/health', { CACHE_MODE: mode, WEB_PORT: String(port), ...env }, logFd);

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  header: (name: string) => string | undefined;
  text: () => string;
}

/**
 * GET bằng node:http, gửi đúng những header được truyền. Không dùng fetch() cho request có điều kiện: theo đặc tả Fetch,
 * undici tự thêm `Cache-Control: no-cache` + `Pragma: no-cache` khi If-None-Match do mình đặt, và Express/Next (gói
 * `fresh`) coi đó là yêu cầu tải lại nên trả 200 thay vì 304 (README mục 3.4).
 */
export function rawGet(url: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers }, (res) => {
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

/** Đường dẫn file /_next/static mà HTML trỏ tới (script, stylesheet, preload), trừ <script noModule> mà Chrome không
 *  tải — cùng quy tắc với bench/browser-cache.js. */
export function staticAssetsIn(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    if (/\bnomodule\b/i.test(tag)) continue;
    const m = /(?:src|href)="(\/_next\/static\/[^"]+)"/.exec(tag);
    if (m) out.add(m[1]!);
  }
  return [...out];
}

/** Chuỗi duy nhất cho mỗi lượt test, gắn vào query để khóa cache của CDN không dính bản lưu từ lượt trước. */
export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
