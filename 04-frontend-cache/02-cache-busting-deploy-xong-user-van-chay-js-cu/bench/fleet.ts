/**
 * Nhiều người dùng (mỗi người một browser context của Google Chrome hệ thống, headless, cache riêng) dùng CRM qua
 * một lần deploy bản 42 (đổi API danh bạ), đi qua CDN mô phỏng. Đo: tỉ lệ người dùng còn chạy bản cũ theo thời gian,
 * lỗi JS / màn hình trắng / lỗi tải chunk, ghi chú bị mất, request API từ bản cũ, byte tải sau deploy.
 *
 * Kịch bản (nén thời gian, mọi số là giả định của lab):
 * - Trước deploy: USERS − NEW_USERS người mở tab ("tab mở từ sáng"): danh bạ → một khách hàng → (một nửa) Báo cáo →
 *   danh bạ, rồi để tab mở.
 * - Deploy bản 42 (API + frontend). PURGE=1: xóa cache CDN ngay sau deploy.
 * - Sau deploy POST_S giây: mỗi người nghỉ THINK_MIN_MS – THINK_MAX_MS giữa hai thao tác, chọn theo xác suất:
 *   điều hướng 55 %, lưu ghi chú 25 %, mở tab mới 12 %, F5 8 %. Gặp màn hình trắng thì F5; trắng lần nữa thì Ctrl+F5.
 *   NEW_USERS người mới (cache trống) vào trong JOIN_WINDOW_S giây đầu sau deploy.
 * - Mỗi người dùng có PRNG riêng (SEED), nên bản trước và bản sau nhận cùng chuỗi lựa chọn.
 *   SITE=sau RUN=main NAME=sau pnpm bench:fleet      (USERS=24 NEW_USERS=6 POST_S=300 KEEP=3 PURGE=0)
 * Cần CDN đang chạy (docker compose up -d --wait), cổng API của site trống.
 */
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserContext, Page } from 'playwright-core';
import { purgeCdn } from '../scripts/cdn';
import { deploy, resetSite } from '../scripts/deploy';
import type { Site } from '../web/releases';
import { apiUrl, launchChrome, newUser, siteOrigin, startApi } from '../test/support/lab';
import { analyzeFleet } from './analyze-fleet';
import { cdnLinesSince, environment, resultsDir, rng, startLoadSampler, startSleepDetector, writeJson } from './lib';

const SITE: Site = process.env.SITE === 'truoc' ? 'truoc' : 'sau';
const NAME = process.env.NAME ?? SITE;
const USERS = Number(process.env.USERS ?? 24);
const NEW_USERS = Number(process.env.NEW_USERS ?? 6);
const PRE_S = Number(process.env.PRE_S ?? 40);
const POST_S = Number(process.env.POST_S ?? 300);
const THINK_MIN = Number(process.env.THINK_MIN_MS ?? 3_000);
const THINK_MAX = Number(process.env.THINK_MAX_MS ?? 9_000);
const JOIN_WINDOW_S = Number(process.env.JOIN_WINDOW_S ?? 120);
const SEED = Number(process.env.SEED ?? 42);
const KEEP = process.env.KEEP ? Number(process.env.KEEP) : undefined;
const PURGE = process.env.PURGE === '1';
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 15_000);
const ACTION_TIMEOUT_MS = 8_000;
const dir = resultsDir();
const origin = siteOrigin(SITE);

export interface Observation {
  at: number;
  uid: string;
  action: string;
  ok: boolean;
  before: string | null;
  version: string | null;
  screen: string | null;
  blank: boolean;
  banner: boolean;
  ms: number;
  note?: string;
}
export interface Sample {
  at: number;
  /** Mốc lấy mẫu: k × SAMPLE_MS sau deploy. */
  k: number;
  uid: string;
  version: string | null;
  blank: boolean;
}
interface PageState {
  version: string | null;
  screen: string | null;
  alert: boolean;
  blank: boolean;
  errors: number;
  banner: boolean;
  noteStatus: string | null;
}

let T0 = Number.POSITIVE_INFINITY;
const now = () => Date.now() - T0;
const observations: Observation[] = [];
const samples: Sample[] = [];
const pageErrors: { at: number; uid: string; message: string }[] = [];
const failedResponses: { at: number; uid: string; status: number; url: string }[] = [];

const readState = (page: Page): Promise<PageState> =>
  page.evaluate(() => ({
    version: window.__APP__?.version ?? null,
    screen: document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null,
    alert: document.querySelector('[role=alert]') !== null,
    blank: (document.getElementById('root')?.childElementCount ?? 0) === 0,
    errors: window.__LAB__?.errors.length ?? 0,
    banner: document.getElementById('update-banner') !== null,
    noteStatus: document.querySelector('[data-note-status]')?.getAttribute('data-note-status') ?? null,
  }));

class SimUser {
  page: Page | null = null;
  blankStreak = 0;
  notes = 0;
  constructor(
    readonly uid: string,
    readonly kind: 'mo-san' | 'moi',
    readonly ctx: BrowserContext,
    readonly rand: () => number,
  ) {}

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }

  async state(): Promise<PageState | null> {
    if (!this.page) return null;
    try {
      return await readState(this.page);
    } catch {
      return null; // đang chuyển trang
    }
  }

  /** Chờ màn hình xong: đúng màn mong đợi (đã có dữ liệu), báo lỗi, hoặc trắng kèm lỗi JS; quá giờ thì trả trạng thái cuối. */
  async settle(expect: (s: PageState) => boolean): Promise<PageState | null> {
    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    let last: PageState | null = null;
    while (Date.now() < deadline) {
      const s = await this.state();
      if (s) {
        last = s;
        if (expect(s) || s.alert || (s.blank && s.errors > 0)) return s;
      }
      await sleep(100);
    }
    return last;
  }

  watch(page: Page): void {
    page.on('pageerror', (e) => pageErrors.push({ at: Date.now(), uid: this.uid, message: e.message.slice(0, 300) }));
    page.on('response', (r) => {
      if (r.status() >= 400) failedResponses.push({ at: Date.now(), uid: this.uid, status: r.status(), url: r.url().replace(origin, '') });
    });
  }

  async openTab(path: string): Promise<PageState | null> {
    if (this.page) await this.page.close().catch(() => {});
    this.page = await this.ctx.newPage();
    this.watch(this.page);
    await this.page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: ACTION_TIMEOUT_MS }).catch(() => {});
    return this.settle((s) => s.screen !== null);
  }

  async click(selector: string, screen: string): Promise<PageState | null> {
    await this.page!.click(selector, { timeout: 3_000 });
    return this.settle((s) => s.screen === screen);
  }

  async record(action: string, fn: () => Promise<PageState | null>, note?: string): Promise<PageState | null> {
    const before = (await this.state())?.version ?? null;
    const started = Date.now();
    let s: PageState | null = null;
    let ok = true;
    try {
      s = await fn();
    } catch {
      ok = false;
      s = await this.state();
    }
    observations.push({
      at: Date.now(),
      uid: this.uid,
      action,
      ok: ok && s !== null,
      before,
      version: s?.version ?? null,
      screen: s?.screen ?? null,
      blank: s?.blank ?? true,
      banner: s?.banner ?? false,
      ms: Date.now() - started,
      ...(note ? { note } : {}),
    });
    return s;
  }

  goContacts = () => this.record('nav-danh-ba', () => this.click('a[data-nav=contacts]', 'contacts'));
  goReports = () => this.record('nav-bao-cao', () => this.click('a[data-nav=reports]', 'reports'));

  async goDetail(): Promise<PageState | null> {
    let s = await this.state();
    if (s?.screen !== 'contacts') s = await this.goContacts();
    if (s?.screen !== 'contacts') return s;
    const id = 1 + Math.floor(this.rand() * 40);
    return this.record('nav-khach-hang', () => this.click(`a[data-contact="${id}"]`, 'contact-detail'));
  }

  async saveNote(): Promise<void> {
    let s = await this.state();
    if (s?.screen !== 'contact-detail') s = await this.goDetail();
    if (s?.screen !== 'contact-detail') return;
    const text = `Ghi chú ${this.uid}-${++this.notes}`;
    await this.record(
      'luu-ghi-chu',
      async () => {
        await this.page!.fill('[data-note-input]', text, { timeout: 3_000 });
        await this.page!.click('[data-note-save]', { timeout: 3_000 });
        return this.settle((st) => st.noteStatus === 'saved' || st.noteStatus === 'failed');
      },
      text,
    );
  }

  reload = (hard: boolean) =>
    this.record(hard ? 'ctrl-f5' : 'f5', async () => {
      if (hard) {
        // Ctrl+F5: tải lại bỏ qua cache (Chrome gửi Cache-Control: no-cache cho mọi request).
        const cdp = await this.ctx.newCDPSession(this.page!);
        await cdp.send('Page.reload', { ignoreCache: true });
        await cdp.detach().catch(() => {});
        await this.page!.waitForLoadState('load', { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      } else {
        await this.page!.reload({ waitUntil: 'load', timeout: ACTION_TIMEOUT_MS });
      }
      return this.settle((st) => st.screen !== null);
    });

  /** Trước deploy: danh bạ → một khách hàng → (một nửa) Báo cáo → để tab ở danh bạ hoặc ở một khách hàng (một nửa). */
  async warmUp(): Promise<void> {
    await this.record('mo-tab', () => this.openTab('/'));
    await this.goDetail();
    if (this.rand() < 0.5) await this.goReports();
    if (this.rand() < 0.5) await this.goDetail();
    else await this.goContacts();
  }

  /** Sau deploy: vòng thao tác tới hết giờ. */
  async loop(until: number): Promise<void> {
    while (now() < until) {
      await sleep(THINK_MIN + this.rand() * (THINK_MAX - THINK_MIN));
      if (now() >= until) break;
      const s = await this.state();
      if (!s || (s.screen === null && !s.alert)) {
        // Màn hình trắng hoặc kẹt: khách bấm F5, lần sau Ctrl+F5 (lời khuyên quen thuộc của bộ phận hỗ trợ).
        this.blankStreak++;
        await this.reload(this.blankStreak >= 2);
        continue;
      }
      this.blankStreak = 0;
      const r = this.rand();
      if (r < 0.55) {
        const target = this.pick(['contacts', 'reports', 'detail'] as const);
        if (target === 'detail') await this.goDetail();
        else if (target === 'reports' && s.screen !== 'reports') await this.goReports();
        else if (s.screen !== 'contacts') await this.goContacts();
        else await this.goReports();
      } else if (r < 0.8) await this.saveNote();
      else if (r < 0.92) await this.record('mo-tab-moi', () => this.openTab('/'));
      else await this.reload(false);
    }
  }
}

/**
 * Mẫu phiên bản: mỗi SAMPLE_MS (mốc k × SAMPLE_MS sau deploy) đọc đồng thời mọi tab đang mở. Tab đang chuyển trang
 * thì thử lại trong 2 giây; vẫn không đọc được thì ghi version null (không rõ), không tính là bản cũ.
 * (Lượt `truoc` đầu tiên đọc tuần tự từng tab nên lúc máy tải cao một vòng kéo dài hơn SAMPLE_MS và mất mốc.)
 */
async function sampler(users: SimUser[], until: number): Promise<void> {
  const read = async (u: SimUser) => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const s = await Promise.race([u.state(), sleep(1_000).then(() => null)]);
      if (s) return s;
      await sleep(200);
    }
    return null;
  };
  for (let k = 0; ; k++) {
    const target = k * SAMPLE_MS;
    if (now() < target) await sleep(target - now());
    const present = users.filter((u) => u.page);
    const states = await Promise.all(present.map(read));
    present.forEach((u, i) => samples.push({ at: Date.now(), k, uid: u.uid, version: states[i]?.version ?? null, blank: states[i]?.blank ?? true }));
    if (target >= until) return;
  }
}

const startedAt = Date.now();
resetSite(SITE);
await purgeCdn();
const apiLog = join(dir, `fleet-${NAME}-api.log`);
const api = await startApi(SITE, '41', { REQUEST_LOG: apiLog }, openSync(join(dir, `fleet-${NAME}-api.out`), 'a'));
const browser = await launchChrome();
const env = await environment(browser.version());
const load = startLoadSampler();
const sleepDetector = startSleepDetector();
let loadSamples: Awaited<ReturnType<typeof load.stop>> | null = null;
try {
  const first = await deploy({ site: SITE, release: '41', api: apiUrl(SITE) });
  const users: SimUser[] = [];
  for (let i = 0; i < USERS; i++) {
    const uid = `u${String(i + 1).padStart(2, '0')}`;
    users.push(new SimUser(uid, i < USERS - NEW_USERS ? 'mo-san' : 'moi', await newUser(browser, SITE, uid), rng(SEED * 1000 + i)));
  }
  const openers = users.filter((u) => u.kind === 'mo-san');
  const joiners = users.filter((u) => u.kind === 'moi');
  console.log(`${NAME}: ${openers.length} tab mở sẵn, ${joiners.length} người mới sau deploy, ${POST_S} s sau deploy`);
  await Promise.all(
    openers.map(async (u, i) => {
      await sleep((i * PRE_S * 600) / openers.length);
      await u.warmUp();
    }),
  );
  const preEnd = startedAt + PRE_S * 1000 + 5_000;
  if (Date.now() < preEnd) await sleep(preEnd - Date.now());

  const second = await deploy({ site: SITE, release: '42', api: apiUrl(SITE), keepReleases: KEEP });
  T0 = second.finishedAt;
  if (PURGE) await purgeCdn();
  console.log(`deploy 42 xong (${second.finishedAt - second.startedAt} ms)${PURGE ? ', đã xóa cache CDN' : ''}`);
  const until = POST_S * 1000;
  const joinAt = joiners.map((u) => u.rand() * JOIN_WINDOW_S * 1000);
  await Promise.all([
    sampler(users, until),
    ...openers.map((u) => u.loop(until)),
    ...joiners.map(async (u, i) => {
      await sleep(joinAt[i]!);
      await u.record('mo-tab', () => u.openTab('/'));
      await u.loop(until);
    }),
  ]);
  for (const u of users) await u.ctx.close().catch(() => {});
  const cdn = await cdnLinesSince(`${SITE}.localhost`, startedAt);
  const raw = {
    site: SITE,
    name: NAME,
    config: { USERS, NEW_USERS, PRE_S, POST_S, THINK_MIN, THINK_MAX, JOIN_WINDOW_S, SEED, KEEP: KEEP ?? 3, PURGE, SAMPLE_MS },
    environment: env,
    startedAt,
    deployAt: T0,
    deploys: [first, second].map((d) => ({ release: d.release, startedAt: d.startedAt, finishedAt: d.finishedAt, steps: d.steps })),
    users: users.map((u) => ({ uid: u.uid, kind: u.kind })),
    // t = mili giây tính từ lúc deploy bản 42 xong (âm = trước deploy).
    observations: observations.map((o) => ({ t: o.at - T0, ...o })),
    samples: samples.map((o) => ({ t: o.at - T0, ...o })),
    pageErrors: pageErrors.map((o) => ({ t: o.at - T0, ...o })),
    failedResponses: failedResponses.map((o) => ({ t: o.at - T0, ...o })),
    load: (loadSamples = await load.stop()),
    // Khoảng máy ngủ trong lượt (lượt có khoảng ngủ là lượt bẩn, không dùng số theo thời gian).
    machineSleep: sleepDetector.stop(),
  };
  writeJson(join(dir, `fleet-${NAME}.json`), raw);
  writeJson(join(dir, `fleet-${NAME}-cdn.json`), cdn);
  writeJson(join(dir, `fleet-${NAME}-summary.json`), analyzeFleet(raw, apiLog, cdn));
} finally {
  if (!loadSamples) await load.stop();
  await browser.close().catch(() => {});
  await api.stop();
}
