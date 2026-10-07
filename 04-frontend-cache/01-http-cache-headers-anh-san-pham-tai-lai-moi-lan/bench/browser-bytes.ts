/**
 * Byte "Transferred" của trang danh mục ở lượt xem đầu và lượt xem lặp lại, đo trên Google Chrome đã cài (Playwright
 * channel 'chrome', headless, profile tạm của Playwright), qua CDN mô phỏng. Không bật "Disable cache".
 * Mỗi lần đo: một browser context mới (cache trống) → tab 1 xem trang (lượt đầu) → đóng tab → tab 2 xem lại (lượt lặp lại,
 * như khách mở lại trang trong ngày). Byte = tổng encodedDataLength của Network.loadingFinished (cột Transferred của
 * DevTools); phân loại từng request: memory cache, disk cache, 304 hay 200 từ mạng.
 * Sau đó chạy k6 ở chế độ CHECK=1 với cùng trang và so từng quyết định cache của k6 với Chrome (emulation-check).
 *   RUN=main pnpm bench:bytes      (MODES=truoc,sau RUNS=3 PAGE=/danh-muc/dien-thoai)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type BrowserContext } from 'playwright-core';
import type { CacheMode } from '../src/shared/config';
import { SECRET, sessionCookie } from '../test/support/lab';
import { collectCdnLog, environment, median, resetCdn, resultsDir, startOrigins, writeJson } from './lib';

const MODES = (process.env.MODES ?? 'truoc,sau').split(',') as CacheMode[];
const RUNS = Number(process.env.RUNS ?? 3);
const PAGE = process.env.PAGE ?? '/danh-muc/dien-thoai';
const ORIGIN = 'http://127.0.0.1:58088';
const USER_ID = 77;
const dir = resultsDir();

interface Req {
  url: string;
  type?: string;
  status?: number;
  netStatus?: number;
  fromDiskCache?: boolean;
  fromMemoryCache?: boolean;
  bytes?: number;
  failed?: string;
  sent?: { accept?: string; acceptEncoding?: string; ifNoneMatch?: string; cacheControl?: string };
  cacheControl?: string;
  cdn?: string;
}

const classify = (r: Req) => (r.fromMemoryCache ? 'memory-cache' : r.fromDiskCache ? 'disk-cache' : r.netStatus === 304 ? 'network-304' : `network-${r.netStatus ?? r.status ?? '?'}`);

async function measureView(ctx: BrowserContext) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const reqs = new Map<string, Req>();
  const get = (id: string) => reqs.get(id) ?? (reqs.set(id, { url: '' }), reqs.get(id)!);
  cdp.on('Network.requestWillBeSent', (e) => Object.assign(get(e.requestId), { url: e.request.url.replace(ORIGIN, ''), type: e.type }));
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const h = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    get(e.requestId).sent = { accept: h.accept, acceptEncoding: h['accept-encoding'], ifNoneMatch: h['if-none-match'], cacheControl: h['cache-control'] };
  });
  cdp.on('Network.responseReceived', (e) => {
    const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    Object.assign(get(e.requestId), { status: e.response.status, fromDiskCache: e.response.fromDiskCache, cacheControl: h['cache-control'], cdn: h['x-cache-status'] });
  });
  cdp.on('Network.responseReceivedExtraInfo', (e) => {
    get(e.requestId).netStatus = e.statusCode;
  });
  cdp.on('Network.requestServedFromCache', (e) => {
    get(e.requestId).fromMemoryCache = true;
  });
  cdp.on('Network.loadingFinished', (e) => {
    get(e.requestId).bytes = e.encodedDataLength;
  });
  cdp.on('Network.loadingFailed', (e) => {
    get(e.requestId).failed = e.errorText;
  });
  const started = Date.now();
  await page.goto(`${ORIGIN}${PAGE}`, { waitUntil: 'load' });
  // Trang tự gọi JSON rồi mới vẽ ảnh: chờ đủ ảnh hiện xong và mạng im 500 ms.
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>('main img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0) && document.querySelector('.cart[data-user]') !== null;
  });
  await page.waitForLoadState('networkidle');
  const doneMs = Date.now() - started;
  await sleep(300);
  await page.close();
  const list = [...reqs.values()].filter((r) => r.url && !r.url.startsWith('data:'));
  const byClass: Record<string, { count: number; bytes: number }> = {};
  for (const r of list) {
    const c = classify(r);
    byClass[c] ??= { count: 0, bytes: 0 };
    byClass[c].count++;
    byClass[c].bytes += r.bytes ?? 0;
  }
  return { totalBytes: list.reduce((s, r) => s + (r.bytes ?? 0), 0), requests: list.length, doneMs, byClass, list };
}

/** Quyết định cache của Chrome cho từng URL, cùng kiểu với k6 (use / revalidate / fetch). */
const chromeAction = (r: Req) => (r.fromMemoryCache || r.fromDiskCache ? 'use' : r.sent?.ifNoneMatch ? 'revalidate' : 'fetch');

function k6Check(mode: CacheMode) {
  const consoleFile = join(dir, `emulation-check-${mode}-k6.log`);
  const res = spawnSync('k6', ['run', '--quiet', `--console-output=${consoleFile}`, 'bench/repeat-visit.k6.js'], {
    env: { ...process.env, CHECK: '1', SESSION_SECRET: SECRET },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`k6 CHECK lỗi: ${res.stderr}`);
  return readFileSync(consoleFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const msg = /msg="(.*)"$/.exec(line)?.[1] ?? '';
      return JSON.parse(JSON.parse(`"${msg}"`) as string) as { visit: string; url: string; action: string };
    });
}

const env = await environment();
const summary: Record<string, unknown> = {};
for (const mode of MODES) {
  const origins = await startOrigins(mode, dir, `bytes-${mode}`, true);
  await resetCdn();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const runs: { run: number; first: Awaited<ReturnType<typeof measureView>>; repeat: Awaited<ReturnType<typeof measureView>> }[] = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: 'sid', value: sessionCookie(USER_ID).split('=')[1]!, url: ORIGIN }]);
      const first = await measureView(ctx);
      const repeat = await measureView(ctx);
      await ctx.close();
      runs.push({ run: i + 1, first, repeat });
      console.log(`${mode} lần ${i + 1}: lượt đầu ${first.totalBytes} B / ${first.requests} request · lượt lặp lại ${repeat.totalBytes} B ·`, repeat.byClass);
    }
    // Đối chiếu k6 với Chrome ở lần đo đầu tiên (cùng trang, cùng chuỗi lượt đầu → lượt lặp lại).
    const k6 = k6Check(mode);
    const compare = (['first', 'repeat'] as const).map((visit) => {
      const chrome = new Map(runs[0]![visit].list.map((r) => [r.url, chromeAction(r)]));
      const emu = new Map(k6.filter((x) => x.visit === visit).map((x) => [x.url, x.action]));
      const urls = [...new Set([...chrome.keys(), ...emu.keys()])].sort();
      const mismatches = urls.filter((u) => chrome.get(u) !== emu.get(u)).map((u) => ({ url: u, chrome: chrome.get(u) ?? null, k6: emu.get(u) ?? null }));
      return { visit, chromeRequests: chrome.size, k6Requests: emu.size, mismatches };
    });
    const ua = await (async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      const v = await p.evaluate(() => navigator.userAgent);
      await ctx.close();
      return v;
    })();
    const result = {
      mode,
      page: PAGE,
      chrome: { version: browser.version(), userAgent: ua, channel: 'chrome', headless: true, path: '/Applications/Google Chrome.app' },
      environment: env,
      runs,
      medianRepeatBytes: median(runs.map((r) => r.repeat.totalBytes)),
      medianFirstBytes: median(runs.map((r) => r.first.totalBytes)),
      emulationCheck: compare,
    };
    writeJson(join(dir, `bytes-${mode}.json`), result);
    summary[mode] = { first: runs.map((r) => r.first.totalBytes), repeat: runs.map((r) => r.repeat.totalBytes), emulationMismatches: compare.map((c) => c.mismatches) };
  } finally {
    await browser.close();
    await origins.stop();
    await collectCdnLog(join(dir, `bytes-${mode}-cdn.log`));
  }
}
console.log(JSON.stringify(summary, null, 2));
