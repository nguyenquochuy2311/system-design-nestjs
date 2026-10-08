/**
 * Chỉ số 3 và 4 ở mục 5 (request /orders mỗi điều phối viên mỗi giờ, độ cũ tối đa khi đang xem), kèm quay lại sau phân
 * đơn: một giờ thật (DURATION_S) của nhiều điều phối viên, mỗi người một browser context của Chrome hệ thống.
 *
 * Ba bản chạy cùng lúc trên cùng API và cùng chuỗi thay đổi dữ liệu: truoc, sau, sau-khong-poll (bản sau tắt làm mới
 * định kỳ bằng cookie lab_poll=off, để tách phần request do làm mới định kỳ). Mỗi bản DISPATCHERS người (uid
 * h-<bản>-dNN, số NN quyết định khu vực, cùng số = cùng khu vực ở mọi bản), mỗi người có PRNG riêng theo SEED và NN nên
 * ba bản nhận cùng chuỗi thời gian và loại thao tác (hàng được chọn theo PRNG riêng của từng bản). Nhịp thao tác (giả định của lab, khoảng 40 lần quay lại mỗi giờ như mục 1):
 *  - ở danh sách LIST_MIN_S – LIST_MAX_S giây, rồi: mở chi tiết (P_DETAIL), đổi trang (P_PAGE) hoặc đổi trạng thái;
 *  - ở chi tiết DETAIL_MIN_S – DETAIL_MAX_S giây; P_ASSIGN số lần bấm phân đơn (nếu đơn còn "Mới") rồi 1 – 3 giây sau Back.
 * "Người khác" (shipper, điều phối viên ngoài lượt đo, đơn mới) đổi dữ liệu mỗi khu vực trung bình OTHERS_MEAN_S giây.
 *   RUN=main NAME=hour pnpm bench:hour       (DURATION_S=3600 DISPATCHERS=8)
 * Cần cổng 3100, 3200 trống. Kết quả thô bench/results/$RUN/hour-$NAME.json; chỉ số tính bằng bench/analyze-hour.ts.
 */
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import { REGIONS } from '../src/shared/orders.store';
import type { AssignResult } from '../web/orders/contracts';
import type { LabEvent } from '../web/orders/lab-types';
import { drainEvents, ensureWebBuild, history, launchChrome, listUrl, newDispatcher, othersTick, requestsSince, resetApi, startApi, startWeb, waitListSettled } from '../test/support/lab';
import { startNavProbe, stopNavProbe, type NavResult } from '../test/support/nav-probe';
import { analyzeHour, type HourRaw, type HourVariant } from './analyze-hour';
import { environment, powerState, resultsDir, rng, startLoadSampler, startSleepDetector, writeJson } from './lib';

const NAME = process.env.NAME ?? 'hour';
const VARIANTS = (process.env.VARIANTS ?? 'truoc,sau,sau-khong-poll').split(',') as HourVariant[];
const DISPATCHERS = Number(process.env.DISPATCHERS ?? 8);
const DURATION_S = Number(process.env.DURATION_S ?? 3600);
const SEED = Number(process.env.SEED ?? 7);
const LIST_MIN_S = 10;
const LIST_MAX_S = 60;
const DETAIL_MIN_S = 10;
const DETAIL_MAX_S = 50;
const P_DETAIL = 0.8;
const P_PAGE = 0.1;
const P_ASSIGN = 0.25;
const OTHERS_MEAN_S = Number(process.env.OTHERS_MEAN_S ?? 20);
const STAGGER_S = 30;
const dir = resultsDir();

const base = (v: HourVariant) => (v === 'truoc' ? 'truoc' : 'sau');
const pad = (n: number) => String(n).padStart(2, '0');

const raw: HourRaw = {
  meta: {} as HourRaw['meta'],
  dispatchers: [],
  actions: [],
  backs: [],
  events: {},
  history: { seed: 0, t0: 0, initial: [], changes: [] },
  requests: [],
};
const pages = new Map<string, Page>();
const errors: { t: number; uid: string; message: string }[] = [];

async function drainAll(): Promise<void> {
  await Promise.all(
    [...pages].map(async ([uid, page]) => {
      const ev = await drainEvents(page).catch(() => [] as LabEvent[]);
      (raw.events[uid] ??= []).push(...ev);
    }),
  );
}

/** Kết thúc một lần quay lại: đọc bộ đo (đã chạy suốt thời gian ở danh sách nên có cả lúc bản mới về). */
async function finishBack(page: Page, pending: { uid: string; variant: HourVariant; detailMs: number; assigned: AssignResult | null }): Promise<void> {
  const r: NavResult = await stopNavProbe(page);
  const firstData = r.timeline.find((e) => e.ids.length > 0);
  const withAssign = pending.assigned ? r.timeline.find((e) => e.ids.length > 0 && (e.seq ?? -1) >= pending.assigned!.seq) : undefined;
  const { timeline, ...rest } = r;
  raw.backs.push({
    ...pending,
    ...rest,
    firstSeq: firstData?.seq ?? null,
    firstShowsAssignment: pending.assigned ? (firstData?.seq ?? -1) >= pending.assigned.seq : null,
    assignmentVisibleMs: withAssign ? withAssign.ms : null,
    timelineEntries: timeline.length,
  });
}

async function dispatcher(browser: Awaited<ReturnType<typeof launchChrome>>, variant: HourVariant, n: number, endAt: number): Promise<void> {
  const uid = `h-${variant}-d${pad(n)}`;
  const rand = rng(SEED * 1000 + n);
  // Hàng được chọn theo dòng PRNG riêng của từng bản: cùng PRNG thì ba bản chọn đúng một đơn cùng lúc và tranh nhau
  // phân đơn (409 giả tạo, gặp ở lượt thử).
  const rowRand = rng(SEED * 1000 + n + 100 * (VARIANTS.indexOf(variant) + 1));
  const ctx = await newDispatcher(browser, uid, variant === 'sau-khong-poll' ? { lab_poll: 'off' } : {});
  const page = await ctx.newPage();
  const act = (action: string, extra: Record<string, unknown> = {}) => raw.actions.push({ t: Date.now(), uid, variant, action, ...extra });
  await sleep(rand() * STAGGER_S * 1000);
  const startedAt = Date.now();
  pages.set(uid, page);
  await page.goto(listUrl(base(variant)));
  await waitListSettled(page, 20_000);
  act('open');
  let pending: Parameters<typeof finishBack>[1] | null = null;
  let status: 'moi' | 'tat-ca' | 'da-nhan' = 'moi';
  let pageNo = 1;
  while (Date.now() < endAt) {
    // Mọi số ngẫu nhiên của một vòng rút trước, để ba bản tiêu thụ PRNG giống nhau dù trang trả về khác nhau.
    const [rList, rAction, rDetail, rAssign, rSplit, rAfter, rFilter] = Array.from({ length: 7 }, rand) as number[] as [number, number, number, number, number, number, number];
    const rRow = rowRand();
    const listMs = (LIST_MIN_S + rList * (LIST_MAX_S - LIST_MIN_S)) * 1000;
    await sleep(Math.max(0, Math.min(listMs, endAt - Date.now())));
    if (pending) {
      await finishBack(page, pending).catch((e: Error) => errors.push({ t: Date.now(), uid, message: `finishBack: ${e.message}` }));
      pending = null;
    }
    if (Date.now() >= endAt) break;
    try {
      if (rAction < P_DETAIL) {
        const rows = await page.locator('[data-testid="order-link"]').count();
        if (rows === 0) {
          act('no-rows');
          continue;
        }
        const link = page.locator('[data-testid="order-link"]').nth(Math.floor(rRow * rows));
        await link.scrollIntoViewIfNeeded();
        await link.click();
        await page.waitForSelector('[data-testid="order-detail"]', { timeout: 15_000 });
        const detailAt = Date.now();
        const orderId = await page.getAttribute('[data-testid="order-detail"]', 'data-id');
        act('detail', { orderId });
        const dwellMs = (DETAIL_MIN_S + rDetail * (DETAIL_MAX_S - DETAIL_MIN_S)) * 1000;
        let assigned: AssignResult | null = null;
        if (rAssign < P_ASSIGN) {
          const before = 2_000 + rSplit * Math.max(0, dwellMs - 6_000);
          await sleep(before);
          if ((await page.locator('[data-testid="assign"]').count()) > 0) {
            const resp = page.waitForResponse((r) => r.url().includes('/assign') && r.request().method() === 'POST', { timeout: 15_000 });
            await page.click('[data-testid="assign"]');
            const res = await resp;
            const body = (await res.json().catch(() => null)) as AssignResult | null;
            if (res.status() === 200 && body) assigned = body;
            act('assign', { orderId, status: res.status(), seq: body?.seq ?? null });
            await page.waitForSelector('[data-testid="detail-message"]', { timeout: 15_000 }).catch(() => undefined);
          } else act('assign-skipped', { orderId });
          await sleep(1_000 + rAfter * 2_000);
        } else await sleep(dwellMs);
        if (Date.now() >= endAt) break;
        await startNavProbe(page);
        act('back', { assigned: assigned !== null });
        // Danh sách có thể rỗng (trang 2 khi hàng đợi vơi): bảng hiện mà không có hàng cũng là "đã hiện".
        await page.waitForFunction(
          () =>
            (window as unknown as { __NAV__?: NavResult }).__NAV__?.rowsFrameMs != null ||
            [...document.querySelectorAll<HTMLElement>('[data-testid="order-table"]')].some((t) => t.checkVisibility() && t.querySelector('[data-testid="order-row"]') === null),
          undefined,
          { timeout: 20_000, polling: 50 },
        );
        pending = { uid, variant, detailMs: Date.now() - detailAt, assigned };
      } else if (rAction < P_DETAIL + P_PAGE) {
        const next = pageNo === 1 ? 'page-next' : 'page-prev';
        if (await page.isEnabled(`[data-testid="${next}"]`)) {
          await page.click(`[data-testid="${next}"]`);
          pageNo = pageNo === 1 ? 2 : 1;
          act('page', { page: pageNo });
          await waitListSettled(page, 20_000);
        }
      } else {
        status = status === 'moi' ? (rFilter < 0.5 ? 'tat-ca' : 'da-nhan') : 'moi';
        pageNo = 1;
        await page.selectOption('[data-testid="filter-status"]', status);
        act('filter', { status });
        await waitListSettled(page, 20_000);
      }
    } catch (e) {
      errors.push({ t: Date.now(), uid, message: (e as Error).message.split('\n')[0]! });
      act('error', { message: (e as Error).message.split('\n')[0] });
      // Đưa người dùng về danh sách nếu đang kẹt ở chi tiết; không tải lại trang (sẽ xóa cache của bản sau).
      if (await page.locator('[data-testid="order-detail"]').count()) await page.goBack().catch(() => undefined);
      pending = null;
      await stopNavProbe(page).catch(() => undefined);
    }
  }
  if (pending) await finishBack(page, pending).catch(() => undefined);
  const ev = await drainEvents(page).catch(() => [] as LabEvent[]);
  (raw.events[uid] ??= []).push(...ev);
  pages.delete(uid);
  raw.dispatchers.push({ uid, variant, n, startedAt, endedAt: Date.now() });
  await ctx.close();
}

/** "Người khác" của một khu vực: thời điểm theo phân phối mũ, PRNG riêng (cùng chuỗi mỗi lần chạy với cùng SEED). */
async function others(regionId: string, idx: number, endAt: number): Promise<void> {
  const rand = rng(SEED * 7919 + idx);
  while (Date.now() < endAt) {
    await sleep(Math.min(-Math.log(1 - rand()) * OTHERS_MEAN_S * 1000, Math.max(0, endAt - Date.now())));
    if (Date.now() < endAt) await othersTick(regionId).catch((e: Error) => errors.push({ t: Date.now(), uid: `others-${regionId}`, message: e.message }));
  }
}

const logFd = openSync(join(dir, `hour-${NAME}-processes.log`), 'a');
const build = ensureWebBuild(false);
const api = await startApi({ REQUEST_LOG: join(dir, `hour-${NAME}-requests.jsonl`) }, logFd);
const web = await startWeb({}, logFd);
const browser = await launchChrome();
const chrome = browser.version();
const power = powerState();
await resetApi(SEED);
const startedAt = Date.now();
const endAt = startedAt + DURATION_S * 1000;
const sleepDet = startSleepDetector();
const load = startLoadSampler(30_000);
const drainTimer = setInterval(() => void drainAll(), 10_000);
console.log(`bắt đầu ${new Date(startedAt).toISOString()}, kết thúc dự kiến ${new Date(endAt).toISOString()}; ${VARIANTS.length} bản × ${DISPATCHERS} người`);
const progress = setInterval(() => {
  const backs = raw.backs.length;
  console.log(`${new Date().toISOString()} · quay lại ${backs} · thao tác ${raw.actions.length} · lỗi ${errors.length} · máy ngủ ${sleepDet.gaps.length}`);
}, 60_000);
try {
  await Promise.all([
    ...VARIANTS.flatMap((v) => Array.from({ length: DISPATCHERS }, (_, k) => dispatcher(browser, v, k + 1, endAt))),
    ...REGIONS.map((r, i) => others(r.id, i, endAt)),
  ]);
} finally {
  clearInterval(drainTimer);
  clearInterval(progress);
  raw.history = await history().catch(() => raw.history);
  raw.requests = await requestsSince(0).catch(() => []);
  await browser.close().catch(() => undefined);
  await web.stop();
  await api.stop();
}
const loadOut = load.stop();
raw.meta = {
  name: NAME,
  startedAt,
  endAt,
  finishedAt: Date.now(),
  params: { VARIANTS, DISPATCHERS, DURATION_S, SEED, LIST_MIN_S, LIST_MAX_S, DETAIL_MIN_S, DETAIL_MAX_S, P_DETAIL, P_PAGE, P_ASSIGN, OTHERS_MEAN_S, STAGGER_S },
  build,
  environment: environment(chrome),
  powerAtStart: power,
  powerSources: loadOut.powerSources,
  powerChanged: loadOut.powerChanged,
  machineSleep: sleepDet.stop(),
  load: loadOut.samples,
  errors,
};
writeJson(join(dir, `hour-${NAME}.json`), raw);
const summary = analyzeHour(raw);
writeJson(join(dir, `hour-${NAME}-summary.json`), summary);
console.log(JSON.stringify(summary.byVariant, null, 1));
if (raw.meta.machineSleep.length || raw.meta.powerChanged) console.warn(`LƯỢT BẨN: máy ngủ ${raw.meta.machineSleep.length} lần, nguồn điện ${loadOut.powerSources.join(' → ')} — chạy lại dưới NAME khác`);
