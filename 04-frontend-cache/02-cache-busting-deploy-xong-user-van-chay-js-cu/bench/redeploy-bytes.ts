/**
 * Byte tải ở lượt xem lặp lại sau một lần deploy chỉ sửa màn Báo cáo (bản 42 → 43), và request hỏi lại file tĩnh khi
 * khách bấm F5. Đo trên Google Chrome hệ thống (headless, profile tạm), đọc CDP Network.* như bài 04/01.
 * Mỗi lần đo (RUNS lần, mỗi lần một browser context mới, cache trống):
 *  1. Máy gốc trống, CDN trống, deploy 42. Tab 1: danh bạ → Báo cáo → danh bạ, đóng tab (cache ấm bản 42).
 *  2. Deploy 43 (PURGE=1: xóa cache CDN ngay sau, như đội vận hành purge sau mỗi lần phát hành).
 *  3. Tab 2, lượt xem lặp lại: mở "/", đợi danh bạ, sang Báo cáo. Ghi byte, bản đang chạy, bố cục màn Báo cáo.
 *  4. F5 trên /bao-cao: request nào ra mạng, request nào gửi If-None-Match / If-Modified-Since, 304 ở log CDN.
 *  5. Ctrl+F5 (Page.reload ignoreCache): byte và bản đang chạy.
 *   SITE=sau RUN=main pnpm bench:bytes      (RUNS=3 PURGE=0 NAME=<site>[-purge])
 */
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite } from '../scripts/deploy';
import type { Site } from '../web/releases';
import { apiUrl, launchChrome, newUser, siteOrigin, startApi } from '../test/support/lab';
import { cdnLinesSince, environment, median, resultsDir, startSleepDetector, writeJson } from './lib';

const SITE: Site = process.env.SITE === 'truoc' ? 'truoc' : 'sau';
const PURGE = process.env.PURGE === '1';
const NAME = process.env.NAME ?? `${SITE}${PURGE ? '-purge' : ''}`;
const RUNS = Number(process.env.RUNS ?? 3);
const dir = resultsDir();
const origin = siteOrigin(SITE);

interface Req {
  url: string;
  phase: string;
  status?: number;
  netStatus?: number;
  fromDiskCache?: boolean;
  fromMemoryCache?: boolean;
  bytes?: number;
  sentConditional?: boolean;
  sentCacheControl?: string;
}
const classify = (r: Req) => (r.fromMemoryCache ? 'memory-cache' : r.fromDiskCache ? 'disk-cache' : r.netStatus === 304 ? 'network-304' : `network-${r.netStatus ?? r.status ?? '?'}`);
const isStatic = (url: string) => !url.startsWith('/api/');

async function tracker(ctx: BrowserContext, page: Page) {
  const cdp: CDPSession = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const reqs = new Map<string, Req>();
  let phase = 'idle';
  const get = (id: string) => reqs.get(id) ?? (reqs.set(id, { url: '', phase }), reqs.get(id)!);
  cdp.on('Network.requestWillBeSent', (e) => Object.assign(get(e.requestId), { url: e.request.url.replace(origin, ''), phase }));
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const h = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    Object.assign(get(e.requestId), { sentConditional: 'if-none-match' in h || 'if-modified-since' in h, sentCacheControl: h['cache-control'] });
  });
  cdp.on('Network.responseReceived', (e) => Object.assign(get(e.requestId), { status: e.response.status, fromDiskCache: e.response.fromDiskCache }));
  cdp.on('Network.responseReceivedExtraInfo', (e) => {
    get(e.requestId).netStatus = e.statusCode;
  });
  cdp.on('Network.requestServedFromCache', (e) => {
    get(e.requestId).fromMemoryCache = true;
  });
  cdp.on('Network.loadingFinished', (e) => {
    get(e.requestId).bytes = e.encodedDataLength;
  });
  return {
    cdp,
    begin: (p: string) => {
      phase = p;
    },
    summary: (p: string) => {
      const list = [...reqs.values()].filter((r) => r.phase === p && r.url && !r.url.startsWith('data:'));
      const byClass: Record<string, { count: number; bytes: number }> = {};
      for (const r of list) {
        const c = classify(r);
        byClass[c] ??= { count: 0, bytes: 0 };
        byClass[c].count++;
        byClass[c].bytes += r.bytes ?? 0;
      }
      const stat = list.filter((r) => isStatic(r.url));
      return {
        bytes: list.reduce((s, r) => s + (r.bytes ?? 0), 0),
        staticBytes: stat.reduce((s, r) => s + (r.bytes ?? 0), 0),
        requests: list.length,
        staticFromNetwork: stat.filter((r) => !r.fromMemoryCache && !r.fromDiskCache).map((r) => `${r.url} ${r.netStatus ?? r.status} ${r.bytes ?? 0}B`),
        staticConditional: stat.filter((r) => r.sentConditional).map((r) => r.url),
        byClass,
        list,
      };
    },
  };
}

async function waitScreen(page: Page, screen: string) {
  await page.waitForSelector(`[data-screen=${screen}]`, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
}

const sleepDetector = startSleepDetector();
const env: Record<string, unknown> = {};
const runs: unknown[] = [];
const browser = await launchChrome();
Object.assign(env, await environment(browser.version()));
const api = await startApi(SITE, '42', {}, openSync(join(dir, `bytes-${NAME}-api.out`), 'a'));
try {
  for (let i = 1; i <= RUNS; i++) {
    resetSite(SITE);
    await purgeCdn();
    await deploy({ site: SITE, release: '42', api: apiUrl(SITE) });
    const ctx = await newUser(browser, SITE, `bytes-${i}`);
    const warm = await ctx.newPage();
    await warm.goto(`${origin}/`, { waitUntil: 'load' });
    await waitScreen(warm, 'contacts');
    await warm.click('a[data-nav=reports]');
    await waitScreen(warm, 'reports');
    await warm.click('a[data-nav=contacts]');
    await waitScreen(warm, 'contacts');
    await warm.close();

    const d43 = await deploy({ site: SITE, release: '43', api: apiUrl(SITE) });
    if (PURGE) await purgeCdn();
    await sleep(1_000);

    const page = await ctx.newPage();
    const t = await tracker(ctx, page);
    const facts = () => page.evaluate(() => ({ version: window.__APP__?.version ?? null, layout: document.querySelector('[data-screen=reports]')?.getAttribute('data-layout') ?? null }));

    t.begin('repeat');
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await waitScreen(page, 'contacts');
    await page.click('a[data-nav=reports]');
    await waitScreen(page, 'reports');
    const repeat = { ...t.summary('repeat'), ...(await facts()) };

    t.begin('f5');
    const f5At = Date.now();
    await page.reload({ waitUntil: 'load' });
    await waitScreen(page, 'reports');
    const f5 = { ...t.summary('f5'), ...(await facts()) };
    const f5End = Date.now();

    t.begin('ctrl-f5');
    await t.cdp.send('Page.reload', { ignoreCache: true });
    await page.waitForLoadState('load');
    await waitScreen(page, 'reports');
    const ctrlF5 = { ...t.summary('ctrl-f5'), ...(await facts()) };

    const cdnF5 = (await cdnLinesSince(`${SITE}.localhost`, f5At)).filter((l) => l.ts * 1000 <= f5End && isStatic(l.u));
    runs.push({
      run: i,
      deploy43Ms: d43.finishedAt - d43.startedAt,
      repeat,
      f5: { ...f5, cdn: { requests: cdnF5.length, status304: cdnF5.filter((l) => l.s === 304).map((l) => l.u), lines: cdnF5 } },
      ctrlF5,
    });
    console.log(
      `${NAME} lần ${i}: lặp lại ${repeat.staticBytes} B tĩnh (bản ${repeat.version}, bố cục ${repeat.layout}) · F5 ${f5.staticBytes} B, hỏi lại có điều kiện: ${f5.staticConditional.length} · Ctrl+F5 ${ctrlF5.staticBytes} B (bản ${ctrlF5.version}, bố cục ${ctrlF5.layout})`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  await api.stop();
}
type Phase = { staticBytes: number; bytes: number };
const pick = (k: 'repeat' | 'f5' | 'ctrlF5') => (runs as Record<string, Phase>[]).map((r) => r[k]!);
writeJson(join(dir, `bytes-${NAME}.json`), {
  site: SITE,
  purge: PURGE,
  name: NAME,
  machineSleep: sleepDetector.stop(),
  environment: env,
  median: {
    repeatStaticBytes: median(pick('repeat').map((p) => p.staticBytes)),
    repeatBytes: median(pick('repeat').map((p) => p.bytes)),
    f5StaticBytes: median(pick('f5').map((p) => p.staticBytes)),
    ctrlF5StaticBytes: median(pick('ctrlF5').map((p) => p.staticBytes)),
  },
  runs,
});
