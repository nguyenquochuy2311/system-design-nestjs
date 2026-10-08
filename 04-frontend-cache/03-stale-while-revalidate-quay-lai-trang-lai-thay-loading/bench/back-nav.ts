/**
 * Chỉ số 1 và 2 ở mục 5: thời gian từ bấm Back tới khi thấy danh sách, tỷ lệ lần quay lại có vòng xoay; kèm số request
 * /api/orders mỗi lần quay lại, tuổi của bản đang có, lúc bản mới về, vị trí cuộn.
 *
 * Mỗi vòng, mỗi bản: một điều phối viên mới (context mới, cache trống) mở danh sách "Mới", rồi NAVS lần: cuộn tới một
 * hàng (10..44), mở chi tiết, ở đó DWELL rồi bấm Back của trình duyệt (history.back()). DWELL xen kẽ SHORT_MS (còn trong
 * staleTime 15 s) và LONG_MS (đã quá staleTime). Một lúc chỉ đo một bản; thứ tự hai bản đảo giữa các vòng.
 * Mốc "thấy danh sách" = khung hình (requestAnimationFrame) đầu tiên sau khi hàng đầu tiên vào DOM (test/support/nav-probe.ts).
 *   RUN=main ROUNDS=3 NAVS=20 pnpm bench:back
 * Cần cổng 3100, 3200 trống. Kết quả: bench/results/$RUN/back-nav.json (thô) và back-nav-summary.json.
 */
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import { ensureWebBuild, launchChrome, listUrl, newDispatcher, requestsSince, resetApi, startApi, startWeb, waitListSettled, type Variant } from '../test/support/lab';
import { startNavProbe, stopNavProbe, type NavResult } from '../test/support/nav-probe';
import { environment, median, percentile, powerState, resultsDir, round, startLoadSampler, startSleepDetector, writeJson, type SleepGap } from './lib';

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const NAVS = Number(process.env.NAVS ?? 20);
const SHORT_MS = Number(process.env.SHORT_MS ?? 3_000);
const LONG_MS = Number(process.env.LONG_MS ?? 20_000);
const VARIANTS: Variant[] = (process.env.VARIANTS?.split(',') as Variant[] | undefined) ?? ['truoc', 'sau'];
const dir = resultsDir();

interface NavRecord extends Omit<NavResult, 'timeline'> {
  variant: Variant;
  round: number;
  i: number;
  dwellMs: number;
  rowIndex: number;
  scrollYBefore: number;
  /** Tuổi của dữ liệu hiện ra đầu tiên lúc bấm Back (wall0 − generatedAt). */
  firstDataAgeMs: number | null;
  ordersRequests: number;
  warehousesRequests: number;
  nextRscRequests: number;
  sleepGaps: SleepGap[];
}

async function oneNav(page: Page, variant: Variant, uid: string, round: number, i: number, rsc: { n: number }): Promise<NavRecord> {
  const dwellMs = i % 2 === 0 ? SHORT_MS : LONG_MS;
  const rowIndex = 10 + ((i * 7) % 35);
  const link = page.locator('[data-testid="order-link"]').nth(rowIndex);
  await link.scrollIntoViewIfNeeded();
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await link.click();
  await page.waitForSelector('[data-testid="order-detail"]');
  await sleep(dwellMs);
  const detector = startSleepDetector();
  rsc.n = 0;
  await startNavProbe(page);
  await page.waitForFunction(() => (window as unknown as { __NAV__?: NavResult }).__NAV__?.rowsFrameMs != null, undefined, { timeout: 15_000, polling: 50 });
  await waitListSettled(page);
  await sleep(300);
  const r = await stopNavProbe(page);
  const reqs = await requestsSince(r.wall0, uid);
  const { timeline: _timeline, ...rest } = r;
  return {
    variant,
    round,
    i,
    dwellMs,
    rowIndex,
    scrollYBefore,
    ...rest,
    firstDataAgeMs: r.firstGeneratedAt === null ? null : r.wall0 - r.firstGeneratedAt,
    ordersRequests: reqs.filter((l) => l.path === '/api/orders').length,
    warehousesRequests: reqs.filter((l) => l.path === '/api/warehouses').length,
    nextRscRequests: rsc.n,
    sleepGaps: detector.stop(),
  };
}

const logFd = openSync(join(dir, 'back-nav-processes.log'), 'a');
const build = ensureWebBuild(false);
const api = await startApi({ REQUEST_LOG: join(dir, 'back-nav-requests.jsonl') }, logFd);
const web = await startWeb({}, logFd);
const browser = await launchChrome();
const startedAt = Date.now();
const power = powerState();
const sleepAll = startSleepDetector();
const load = startLoadSampler();
const navs: NavRecord[] = [];
try {
  for (let round = 1; round <= ROUNDS; round++) {
    const order = round % 2 === 1 ? VARIANTS : [...VARIANTS].reverse();
    for (const variant of order) {
      await resetApi(42);
      const uid = `bn-${variant}-r${round}-d01`;
      const ctx = await newDispatcher(browser, uid);
      const page = await ctx.newPage();
      const rsc = { n: 0 };
      page.on('request', (req) => {
        if (req.headers().rsc === '1') rsc.n++;
      });
      await page.goto(listUrl(variant));
      await waitListSettled(page);
      for (let i = 0; i < NAVS; i++) {
        const rec = await oneNav(page, variant, uid, round, i, rsc);
        navs.push(rec);
        console.log(
          `vòng ${round} ${variant} #${i} ở chi tiết ${rec.dwellMs / 1000}s: thấy danh sách ${round1(rec.rowsFrameMs)} ms, vòng xoay ${rec.spinnerMs === null ? 'không' : 'CÓ'}, bản mới ${round1(rec.freshMs)} ms, /orders ${rec.ordersRequests}, cuộn ${rec.scrollYBefore}→${rec.scrollYAtRows}${rec.sleepGaps.length ? ` · MÁY NGỦ ${JSON.stringify(rec.sleepGaps)}` : ''}`,
        );
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close().catch(() => undefined);
  await web.stop();
  await api.stop();
}
const machineSleep = sleepAll.stop();
const loadSamples = load.stop();

function round1(x: number | null): string {
  return x === null ? '—' : x.toFixed(1);
}

function summarize(rows: NavRecord[]) {
  const frame = rows.map((r) => r.rowsFrameMs!).filter((x) => x !== null);
  return {
    n: rows.length,
    rowsFrameMs: { median: round(median(frame)), min: round(Math.min(...frame)), max: round(Math.max(...frame)), p90: round(percentile(frame, 90)) },
    spinner: rows.filter((r) => r.spinnerMs !== null).length,
    freshMs: (() => {
      const f = rows.map((r) => r.freshMs).filter((x): x is number => x !== null);
      return { n: f.length, median: f.length ? round(median(f)) : null, min: f.length ? round(Math.min(...f)) : null, max: f.length ? round(Math.max(...f)) : null };
    })(),
    firstDataAgeMs: (() => {
      const a = rows.map((r) => r.firstDataAgeMs).filter((x): x is number => x !== null);
      return { median: round(median(a), 0), min: Math.min(...a), max: Math.max(...a) };
    })(),
    ordersRequests: rows.reduce((s, r) => s + r.ordersRequests, 0),
    warehousesRequests: rows.reduce((s, r) => s + r.warehousesRequests, 0),
    nextRscRequests: rows.reduce((s, r) => s + r.nextRscRequests, 0),
    // Vị trí cuộn chỉ có nghĩa khi đã cuộn trước lúc mở chi tiết.
    scrolled: rows.filter((r) => r.scrollYBefore > 0).length,
    scrollKept: rows.filter((r) => r.scrollYBefore > 0 && r.scrollYAtRows === r.scrollYBefore).length,
    scrollAtZero: rows.filter((r) => r.scrollYBefore > 0 && r.scrollYAtRows === 0).length,
    navsWithSleep: rows.filter((r) => r.sleepGaps.length > 0).length,
  };
}

const summary = Object.fromEntries(
  VARIANTS.map((v) => {
    const rows = navs.filter((r) => r.variant === v);
    return [
      v,
      {
        all: summarize(rows),
        byDwell: { [SHORT_MS]: summarize(rows.filter((r) => r.dwellMs === SHORT_MS)), [LONG_MS]: summarize(rows.filter((r) => r.dwellMs === LONG_MS)) },
        byRound: Object.fromEntries(Array.from({ length: ROUNDS }, (_, k) => [k + 1, summarize(rows.filter((r) => r.round === k + 1))])),
      },
    ];
  }),
);

const chrome = await (async () => {
  const b = await launchChrome();
  const v = b.version();
  await b.close();
  return v;
})();
const meta = {
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  params: { ROUNDS, NAVS, SHORT_MS, LONG_MS, VARIANTS },
  build,
  environment: environment(chrome),
  powerAtStart: power,
  machineSleep,
  powerSources: loadSamples.powerSources,
  powerChanged: loadSamples.powerChanged,
  load: { min: Math.min(...loadSamples.samples.map((s) => s.load1)), max: Math.max(...loadSamples.samples.map((s) => s.load1)), samples: loadSamples.samples },
};
writeJson(join(dir, 'back-nav.json'), { meta, navs });
writeJson(join(dir, 'back-nav-summary.json'), { meta: { ...meta, load: { min: meta.load.min, max: meta.load.max } }, summary });
if (machineSleep.length || loadSamples.powerChanged) console.warn(`LƯỢT BẨN: máy ngủ ${machineSleep.length} lần, nguồn điện ${loadSamples.powerSources.join(' → ')} — chạy lại dưới RUN khác`);
console.log(JSON.stringify(summary, null, 1).slice(0, 3000));
