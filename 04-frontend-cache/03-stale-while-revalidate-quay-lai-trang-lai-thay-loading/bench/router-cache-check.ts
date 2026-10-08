/**
 * Kiểm cache router phía client của Next.js 16.4 (README mục 2 ghi "cần xác minh"): bấm Back từ chi tiết về danh sách
 * thì Next có gọi lại server không, component danh sách có bị dựng lại không, dữ liệu hiện ra là bản nào — ở ba cách
 * làm danh sách (truoc: client + useEffect, sau: client + TanStack Query, rsc: Server Component đọc API lúc request),
 * dưới hai chế độ của Next: mặc định, và cacheComponents: true (Next giữ trang cũ bằng <Activity>).
 * Trong lúc ở chi tiết, API đổi đơn đầu danh sách (người khác nhận) để biết bản hiện ra khi Back có mới không.
 * Với rsc, đo thêm điều hướng TIẾN về danh sách bằng <Link> (khác Back); với truoc/sau, đo thêm lần đổi bộ lọc.
 *   RUN=main REPEAT=3 pnpm bench:router      → bench/results/$RUN/router-cache.json
 */
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import type { LabEvent } from '../web/orders/lab-types';
import { changeOrder, ensureWebBuild, launchChrome, listUrl, newDispatcher, peekEvents, requestsSince, resetApi, startApi, startWeb, tableState, waitListSettled } from '../test/support/lab';
import { startNavProbe, stopNavProbe, type NavResult } from '../test/support/nav-probe';
import { environment, resultsDir, startLoadSampler, startSleepDetector, writeJson } from './lib';

const REPEAT = Number(process.env.REPEAT ?? 3);
const DWELL_MS = 2_000;
const dir = resultsDir();
type Kind = 'truoc' | 'sau' | 'rsc';

const shows = async (page: Page) => (await peekEvents(page)).filter((e: LabEvent) => e.type === 'list-show').map((e) => String(e.instance));
const visibleLink = (page: Page, n: number) => page.locator('[data-testid="order-link"]').filter({ visible: true }).nth(n);

async function measureNav(page: Page, uid: string, rsc: { n: number }, how: 'back' | 'link') {
  rsc.n = 0;
  const before = await shows(page);
  if (how === 'back') await startNavProbe(page);
  else {
    await startNavProbe(page, 'none');
    await page.locator('[data-testid="rsc-forward-list"]').filter({ visible: true }).click();
  }
  await page.waitForFunction(() => (window as unknown as { __NAV__?: NavResult }).__NAV__?.rowsFrameMs != null, undefined, { timeout: 20_000, polling: 50 });
  await sleep(2_500); // chờ mọi lần làm mới nền (nếu có)
  const r = await stopNavProbe(page);
  const after = await shows(page);
  const newShows = after.slice(before.length);
  const reqs = await requestsSince(r.wall0, uid);
  return {
    how,
    rowsFrameMs: r.rowsFrameMs,
    spinnerMs: r.spinnerMs,
    freshMs: r.freshMs,
    firstGeneratedAt: r.firstGeneratedAt,
    lastGeneratedAt: r.lastGeneratedAt,
    rscRequests: rsc.n,
    apiOrdersRequests: reqs.filter((l) => l.path === '/api/orders').length,
    /** Component danh sách: dựng lại (mã mới), hiện lại đúng bản cũ (Activity), hay không có sự kiện. */
    listInstance: newShows.length === 0 ? 'khong-hien-lai' : newShows.every((id) => before.includes(id)) ? 'giu-nguyen' : 'dung-lai',
    scrollYAtRows: r.scrollYAtRows,
  };
}

async function oneCheck(browser: Awaited<ReturnType<typeof launchChrome>>, mode: string, kind: Kind, i: number) {
  await resetApi(42);
  const uid = `rc-${mode}-${kind}-${i}-d01`;
  const ctx = await newDispatcher(browser, uid);
  const page = await ctx.newPage();
  const rsc = { n: 0 };
  page.on('request', (req) => {
    if (req.headers().rsc === '1') rsc.n++;
  });
  await page.goto(listUrl(kind));
  await waitListSettled(page, 20_000);
  const first = (await tableState(page))!;
  const changedId = first.rows[0]!.id;
  const link = visibleLink(page, 30);
  await link.scrollIntoViewIfNeeded();
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await link.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="order-detail"]')].some((el) => el.checkVisibility()), undefined, { timeout: 15_000 });
  const change = await changeOrder(changedId, { status: 'da-nhan', assignee: 'Shipper 33' });
  await sleep(DWELL_MS);
  const back = await measureNav(page, uid, rsc, 'back');
  const afterBack = (await tableState(page))!;
  const result: Record<string, unknown> = {
    mode,
    kind,
    i,
    scrollYBefore,
    firstLoadGeneratedAt: first.generatedAt,
    back: {
      ...back,
      showsCachedSnapshot: back.firstGeneratedAt === first.generatedAt,
      /** Đơn đầu danh sách đã được người khác nhận trong lúc ở chi tiết: sau Back (và 2,5 s chờ) còn hiện như "Mới" không. */
      changeVisibleAfterBack: !afterBack.rows.some((r) => r.id === changedId),
      changeAt: change.t,
    },
  };
  if (kind !== 'rsc') {
    // Đổi bộ lọc bằng History API gốc: có gọi server (RSC) không, component danh sách có bị dựng lại không.
    const before = await shows(page);
    rsc.n = 0;
    await page.locator('[data-testid="filter-status"]').filter({ visible: true }).selectOption('da-nhan');
    await waitListSettled(page, 20_000);
    const after = await shows(page);
    result.filterChange = { rscRequests: rsc.n, newListShows: after.length - before.length };
  }
  if (kind === 'rsc') {
    await visibleLink(page, 5).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="rsc-forward-list"]')].some((el) => el.checkVisibility()), undefined, { timeout: 15_000 });
    await sleep(DWELL_MS);
    result.forwardLink = await measureNav(page, uid, rsc, 'link');
  }
  await ctx.close();
  return result;
}

const results: Record<string, unknown>[] = [];
const builds: Record<string, unknown> = {};
const sleepDet = startSleepDetector();
const load = startLoadSampler();
const logFd = openSync(join(dir, 'router-cache-processes.log'), 'a');
let chrome: string | null = null;
for (const mode of ['mac-dinh', 'cache-components'] as const) {
  const cacheComponents = mode === 'cache-components';
  builds[mode] = ensureWebBuild(cacheComponents);
  const api = await startApi({}, logFd);
  const web = await startWeb({ cacheComponents }, logFd);
  const browser = await launchChrome();
  chrome = browser.version();
  try {
    for (let i = 1; i <= REPEAT; i++) {
      for (const kind of ['truoc', 'sau', 'rsc'] as Kind[]) {
        const r = await oneCheck(browser, mode, kind, i);
        results.push(r);
        console.log(JSON.stringify(r));
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await web.stop();
    await api.stop();
  }
}
const loadOut = load.stop();
writeJson(join(dir, 'router-cache.json'), {
  meta: { at: new Date().toISOString(), REPEAT, DWELL_MS, builds, environment: environment(chrome), machineSleep: sleepDet.stop(), powerSources: loadOut.powerSources, powerChanged: loadOut.powerChanged, load: loadOut.samples },
  results,
});
