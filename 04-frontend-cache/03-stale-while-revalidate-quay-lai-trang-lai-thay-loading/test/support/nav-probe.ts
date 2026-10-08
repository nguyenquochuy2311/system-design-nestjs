// Đo một lần quay lại danh sách (nút Back của trình duyệt) ngay trong trang, không dựa vào mã của app: một
// MutationObserver ghi lúc hàng đầu tiên vào DOM, khung hình kế tiếp (requestAnimationFrame, ngay trước lần vẽ), lúc
// vòng xoay xuất hiện, lúc dữ liệu chụp SAU khi bấm Back hiện ra, và mọi bộ lọc/trạng thái hàng đã từng hiện.
import type { Page } from 'playwright-core';

export interface NavResult {
  /** Date.now() và performance.now() ngay trước history.back(). */
  wall0: number;
  t0: number;
  /** ms từ lúc bấm Back. null = không xảy ra trong thời gian chờ. */
  rowsDomMs: number | null;
  rowsFrameMs: number | null;
  spinnerMs: number | null;
  freshMs: number | null;
  refreshingSeen: boolean;
  /** generatedAt của dữ liệu hiện đầu tiên: tuổi của bản đang có lúc quay lại = wall0 − firstGeneratedAt. */
  firstGeneratedAt: number | null;
  lastGeneratedAt: number | null;
  /** Mọi giá trị data-filters của bảng và mọi data-status của hàng đã từng hiện. */
  filtersSeen: string[];
  statusesSeen: string[];
  rowsWereOnScreenBefore: boolean;
  scrollYAtRows: number | null;
  /** Mỗi lần thứ đang hiện đổi: URL lúc đó, bộ lọc của dữ liệu trong bảng, có vòng xoay không, id/trạng thái/kho của hàng. */
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  ms: number;
  search: string;
  filters: string | null;
  seq: number | null;
  generatedAt: number | null;
  placeholder: boolean;
  spinner: boolean;
  ids: string[];
  statuses: string[];
  warehouses: string[];
}

/** Cài bộ quan sát rồi gọi `action` (mặc định: history.back()) trong cùng một lượt evaluate. */
export async function startNavProbe(page: Page, action: 'back' | 'none' = 'back'): Promise<void> {
  await page.evaluate((act) => {
    const N = {
      wall0: Date.now(),
      t0: performance.now(),
      rowsDomMs: null as number | null,
      rowsFrameMs: null as number | null,
      spinnerMs: null as number | null,
      freshMs: null as number | null,
      refreshingSeen: false,
      firstGeneratedAt: null as number | null,
      lastGeneratedAt: null as number | null,
      filtersSeen: [] as string[],
      statusesSeen: [] as string[],
      rowsWereOnScreenBefore: [...document.querySelectorAll('[data-testid="order-row"]')].some((el) => el.checkVisibility()),
      scrollYAtRows: null as number | null,
      timeline: [] as { ms: number; search: string; filters: string | null; seq: number | null; generatedAt: number | null; placeholder: boolean; spinner: boolean; ids: string[]; statuses: string[]; warehouses: string[] }[],
    };
    let lastSig = '';
    const ms = () => performance.now() - N.t0;
    const check = () => {
      // Chỉ xét phần tử đang hiện: với Cache Components, Next giữ trang cũ trong DOM (display: none) bằng <Activity>.
      const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.checkVisibility());
      const spinner = shown('[data-testid="list-loading"]') !== undefined;
      if (N.spinnerMs === null && spinner) N.spinnerMs = ms();
      if (shown('[data-testid="list-refreshing"]')) N.refreshingSeen = true;
      const table = shown('[data-testid="order-table"]');
      const rows = table ? [...table.querySelectorAll<HTMLElement>('[data-testid="order-row"]')] : [];
      const entry = {
        ms: ms(),
        search: location.search,
        filters: table?.dataset.filters ?? null,
        seq: table ? Number(table.dataset.seq) : null,
        generatedAt: table ? Number(table.dataset.generatedAt) : null,
        placeholder: table?.dataset.placeholder === '1',
        spinner,
        ids: rows.map((r) => r.dataset.id ?? ''),
        statuses: [...new Set(rows.map((r) => r.dataset.status ?? ''))],
        warehouses: [...new Set(rows.map((r) => r.dataset.warehouse ?? ''))],
      };
      const sig = JSON.stringify({ ...entry, ms: 0 });
      if (sig !== lastSig) {
        lastSig = sig;
        N.timeline.push(entry);
      }
      if (!table) return;
      const gen = Number(table.dataset.generatedAt);
      const f = table.dataset.filters ?? '';
      if (!N.filtersSeen.includes(f)) N.filtersSeen.push(f);
      for (const r of table.querySelectorAll<HTMLElement>('[data-testid="order-row"]')) {
        const s = r.dataset.status ?? '';
        if (!N.statusesSeen.includes(s)) N.statusesSeen.push(s);
      }
      if (N.rowsDomMs === null && table.querySelector('[data-testid="order-row"]')) {
        N.rowsDomMs = ms();
        N.firstGeneratedAt = gen;
        requestAnimationFrame(() => {
          N.rowsFrameMs = ms();
          N.scrollYAtRows = window.scrollY;
        });
      }
      N.lastGeneratedAt = gen;
      if (N.freshMs === null && gen >= N.wall0) N.freshMs = ms();
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-generated-at', 'data-filters', 'data-status', 'data-testid'] });
    (window as unknown as { __NAV__: typeof N; __NAV_OBS__: MutationObserver }).__NAV__ = N;
    (window as unknown as { __NAV_OBS__: MutationObserver }).__NAV_OBS__ = obs;
    if (act === 'back') history.back();
    else check();
  }, action);
}

export const readNavProbe = (page: Page) => page.evaluate(() => (window as unknown as { __NAV__: NavResult }).__NAV__) as Promise<NavResult>;

export async function stopNavProbe(page: Page): Promise<NavResult> {
  return page.evaluate(() => {
    (window as unknown as { __NAV_OBS__?: MutationObserver }).__NAV_OBS__?.disconnect();
    return (window as unknown as { __NAV__: NavResult }).__NAV__;
  }) as Promise<NavResult>;
}

/**
 * Chờ tới khi bảng có hàng (đã qua một khung hình) và — nếu `fresh` — dữ liệu chụp sau lúc bấm Back đã hiện. Quay lại
 * trong staleTime thì không có lần làm mới nào: gọi với fresh=false.
 */
export async function waitNavDone(page: Page, opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<NavResult> {
  await page.waitForFunction(
    (fresh) => {
      const N = (window as unknown as { __NAV__?: NavResult }).__NAV__;
      return !!N && N.rowsFrameMs !== null && (!fresh || N.freshMs !== null);
    },
    opts.fresh ?? true,
    { timeout: opts.timeoutMs ?? 15_000, polling: 50 },
  );
  return stopNavProbe(page);
}
