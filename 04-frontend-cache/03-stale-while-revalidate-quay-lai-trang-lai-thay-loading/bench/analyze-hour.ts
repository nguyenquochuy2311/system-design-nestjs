/**
 * Tính chỉ số từ file thô của bench/hour.ts (chạy lại được: RUN=main NAME=hour pnpm tsx bench/analyze-hour.ts).
 *
 * Độ cũ của màn hình: mỗi khoảng thời gian danh sách đang hiện một bản dữ liệu (bộ lọc k, bản chụp có số thay đổi s),
 * lấy thời điểm c của thay đổi ĐẦU TIÊN sau s làm kết quả của k khác đi (dựng lại từ lịch sử thay đổi của API bằng
 * đúng hàm listOrders của API). Từ c, màn hình đang cũ; độ cũ ở thời điểm t là t − c. Mỗi khoảng chia hai pha:
 *  - "có sẵn": bản dữ liệu có từ trước lúc bộ lọc/trang hiện tại bắt đầu hiện (bản sau hiện bản trong cache khi quay
 *    lại, khi đổi về một bộ lọc/trang đã xem, hoặc giữ trang cũ làm chỗ giữ), thường kèm "Đang cập nhật…";
 *  - "tải khi xem": bản dữ liệu tải trong lúc bộ lọc/trang đó đang hiện.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatcherOf, listOrders, type HistoryDump } from '../src/shared/orders.store';
import type { RequestLine } from '../src/shared/request-log';
import type { AssignResult, Order } from '../web/orders/contracts';
import type { LabEvent, ListEvent } from '../web/orders/lab-types';
import type { NavResult } from '../test/support/nav-probe';
import { median, percentile, resultsDir, round, type LoadSample, type SleepGap } from './lib';

export type HourVariant = 'truoc' | 'sau' | 'sau-khong-poll';

export interface BackRecord extends Omit<NavResult, 'timeline'> {
  uid: string;
  variant: HourVariant;
  detailMs: number;
  assigned: AssignResult | null;
  firstSeq: number | null;
  firstShowsAssignment: boolean | null;
  assignmentVisibleMs: number | null;
  timelineEntries: number;
}

export interface HourRaw {
  meta: {
    name: string;
    startedAt: number;
    endAt: number;
    finishedAt: number;
    params: Record<string, unknown>;
    build: unknown;
    environment: Record<string, unknown>;
    powerAtStart: Record<string, unknown>;
    powerSources: string[];
    powerChanged: boolean;
    machineSleep: SleepGap[];
    load: LoadSample[];
    errors: { t: number; uid: string; message: string }[];
  };
  dispatchers: { uid: string; variant: HourVariant; n: number; startedAt: number; endedAt: number }[];
  actions: { t: number; uid: string; variant: HourVariant; action: string; [k: string]: unknown }[];
  backs: BackRecord[];
  events: Record<string, LabEvent[]>;
  history: HistoryDump;
  requests: RequestLine[];
}

const STALE_LIMIT_MS = 30_000;

/** Với mỗi (khu vực, bộ lọc): các lần (seq, t) mà kết quả danh sách đổi, dựng lại từ trạng thái ban đầu + lịch sử. */
function resultChanges(history: HistoryDump, keysByRegion: Map<string, Set<string>>): Map<string, { seq: number; t: number }[]> {
  const orders = new Map<string, Order>(history.initial.map((o) => [o.id, { ...o }]));
  const sig = (region: string, key: string) => {
    const [status = 'moi', warehouse = 'tat-ca', page = '1'] = key.split('|');
    return listOrders(orders.values(), region, { status: status as never, warehouse, page: Number(page) })
      .items.map((o) => `${o.id}:${o.status}:${o.assignee ?? ''}`)
      .join(',');
  };
  const last = new Map<string, string>();
  const out = new Map<string, { seq: number; t: number }[]>();
  for (const [region, keys] of keysByRegion) {
    for (const k of keys) {
      last.set(`${region}#${k}`, sig(region, k));
      out.set(`${region}#${k}`, []);
    }
  }
  for (const c of [...history.changes].sort((a, b) => a.seq - b.seq)) {
    orders.set(c.orderId, { ...c.after });
    const region = c.after.region;
    for (const k of keysByRegion.get(region) ?? []) {
      const id = `${region}#${k}`;
      const s = sig(region, k);
      if (s !== last.get(id)) {
        last.set(id, s);
        out.get(id)!.push({ seq: c.seq, t: c.t });
      }
    }
  }
  return out;
}

interface Interval {
  uid: string;
  variant: HourVariant;
  start: number;
  end: number;
  key: string;
  seq: number;
  phase: 'co-san' | 'tai-khi-xem';
  divergedAt: number | null;
  staleMaxMs: number;
  overLimitMs: number;
}

export function analyzeHour(raw: HourRaw) {
  const variantOf = new Map(raw.dispatchers.map((d) => [d.uid, d.variant]));
  const endOf = new Map(raw.dispatchers.map((d) => [d.uid, d.endedAt]));
  const keysByRegion = new Map<string, Set<string>>();
  for (const [uid, evs] of Object.entries(raw.events)) {
    const region = dispatcherOf(uid).region.id;
    for (const e of evs) if (e.type === 'list' && (e as ListEvent).dataKey) (keysByRegion.get(region) ?? keysByRegion.set(region, new Set()).get(region)!).add((e as ListEvent).dataKey!);
  }
  const changes = resultChanges(raw.history, keysByRegion);
  const firstChangeAfter = (region: string, key: string, seq: number) => changes.get(`${region}#${key}`)?.find((c) => c.seq > seq)?.t ?? null;

  const intervals: Interval[] = [];
  for (const [uid, evs] of Object.entries(raw.events)) {
    const variant = variantOf.get(uid);
    if (!variant) continue;
    const region = dispatcherOf(uid).region.id;
    const sorted = [...evs].sort((a, b) => a.t - b.t);
    let shownAt: number | null = null;
    // Lúc bộ lọc/trang đang chọn bắt đầu hiện: đổi lúc mount và lúc đổi bộ lọc/trang.
    let keyShownAt = 0;
    let curKey: string | null = null;
    let cur: Omit<Interval, 'end' | 'staleMaxMs' | 'overLimitMs' | 'divergedAt'> | null = null;
    const close = (end: number) => {
      if (!cur) return;
      const c = firstChangeAfter(region, cur.key, cur.seq);
      const staleMaxMs = c !== null && c < end ? end - c : 0;
      const overLimitMs = c !== null ? Math.max(0, end - Math.max(cur.start, c + STALE_LIMIT_MS)) : 0;
      intervals.push({ ...cur, end, divergedAt: c, staleMaxMs, overLimitMs });
      cur = null;
    };
    for (const e of sorted) {
      if (e.type === 'list-show') {
        close(e.t);
        shownAt = e.t;
        keyShownAt = e.t;
        curKey = null;
      } else if (e.type === 'list-hide') {
        close(e.t);
        shownAt = null;
      } else if (e.type === 'list' && shownAt !== null) {
        close(e.t);
        const l = e as ListEvent;
        if (l.key !== curKey) {
          if (curKey !== null) keyShownAt = e.t;
          curKey = l.key;
        }
        if (l.rows > 0 && l.dataKey && l.seq !== null && l.generatedAt !== null) {
          const fromCache = l.generatedAt < keyShownAt || l.dataKey !== l.key;
          cur = { uid, variant, start: e.t, key: l.dataKey, seq: l.seq, phase: fromCache ? 'co-san' : 'tai-khi-xem' };
        }
      }
    }
    close(endOf.get(uid) ?? raw.meta.finishedAt);
  }

  // Màn hình hiện dữ liệu của bộ lọc khác (trạng thái/kho) với bộ lọc đang chọn trên URL: ràng buộc ở mục 1.
  // Khác trang trong cùng bộ lọc (chỗ giữ của bản sau) không tính.
  const otherFilter: { uid: string; variant: HourVariant; ms: number }[] = [];
  for (const [uid, evs] of Object.entries(raw.events)) {
    const variant = variantOf.get(uid);
    if (!variant) continue;
    const sorted = [...evs].sort((a, b) => a.t - b.t);
    sorted.forEach((e, i) => {
      if (e.type !== 'list') return;
      const l = e as ListEvent;
      if (l.rows === 0 || !l.dataKey) return;
      const [ks, kw] = l.key.split('|');
      const [ds, dw] = l.dataKey.split('|');
      if (ks === ds && kw === dw) return;
      const next = sorted.slice(i + 1).find((x) => x.type === 'list' || x.type === 'list-hide');
      otherFilter.push({ uid, variant, ms: (next?.t ?? endOf.get(uid) ?? e.t) - e.t });
    });
  }

  const byVariant: Record<string, unknown> = {};
  for (const v of [...new Set(raw.dispatchers.map((d) => d.variant))]) {
    const ds = raw.dispatchers.filter((d) => d.variant === v);
    const perHour = (count: (uid: string, from: number, to: number) => number) => {
      const rates = ds.map((d) => count(d.uid, d.startedAt, d.endedAt) / ((d.endedAt - d.startedAt) / 3_600_000));
      return { median: round(median(rates)), min: round(Math.min(...rates)), max: round(Math.max(...rates)) };
    };
    const reqs = (uid: string, from: number, to: number, path?: string) =>
      raw.requests.filter((r) => r.uid === uid && r.t >= from && r.t <= to && (path === undefined ? true : path === 'detail' ? /^\/api\/orders\/[^/]+$/.test(r.path) : r.path === path)).length;
    const backs = raw.backs.filter((b) => b.variant === v);
    const frame = backs.map((b) => b.rowsFrameMs).filter((x): x is number => x !== null);
    const fresh = backs.map((b) => b.freshMs).filter((x): x is number => x !== null);
    const ages = backs.map((b) => (b.firstGeneratedAt === null ? null : b.wall0 - b.firstGeneratedAt)).filter((x): x is number => x !== null);
    const iv = intervals.filter((i) => i.variant === v);
    const phase = (p: Interval['phase'] | 'tat-ca') => {
      const xs = p === 'tat-ca' ? iv : iv.filter((i) => i.phase === p);
      const shownMs = xs.reduce((s, i) => s + (i.end - i.start), 0);
      const stale = xs.map((i) => i.staleMaxMs);
      return {
        intervals: xs.length,
        shownMinutes: round(shownMs / 60_000),
        staleMaxMs: stale.length ? Math.max(...stale) : null,
        staleP99Ms: stale.length ? percentile(stale, 99) : null,
        intervalsOverLimit: xs.filter((i) => i.staleMaxMs > STALE_LIMIT_MS).length,
        overLimitPctOfShownTime: shownMs ? round((100 * xs.reduce((s, i) => s + i.overLimitMs, 0)) / shownMs, 3) : null,
      };
    };
    const assignActs = raw.actions.filter((a) => a.variant === v && a.action === 'assign');
    const afterAssign = backs.filter((b) => b.assigned);
    const visible = afterAssign.map((b) => b.assignmentVisibleMs).filter((x): x is number => x !== null);
    byVariant[v] = {
      dispatchers: ds.length,
      hoursPerDispatcher: round(median(ds.map((d) => (d.endedAt - d.startedAt) / 3_600_000)), 3),
      ordersRequestsPerHour: perHour((u, f, t) => reqs(u, f, t, '/api/orders')),
      ordersRequestsTotal: ds.reduce((s, d) => s + reqs(d.uid, d.startedAt, d.endedAt, '/api/orders'), 0),
      detailRequestsPerHour: perHour((u, f, t) => reqs(u, f, t, 'detail')),
      allApiRequestsPerHour: perHour((u, f, t) => reqs(u, f, t)),
      backs: {
        n: backs.length,
        perHour: perHour((u, f, t) => backs.filter((b) => b.uid === u && b.wall0 >= f && b.wall0 <= t).length),
        withSpinner: backs.filter((b) => b.spinnerMs !== null).length,
        rowsFrameMs: { median: round(median(frame)), p95: round(percentile(frame, 95)), max: round(Math.max(...frame)) },
        firstDataAgeMs: ages.length ? { median: round(median(ages), 0), max: Math.max(...ages) } : null,
        withFreshData: fresh.length,
        freshMs: fresh.length ? { median: round(median(fresh)), max: round(Math.max(...fresh)) } : null,
        refreshingSeen: backs.filter((b) => b.refreshingSeen).length,
      },
      staleness: { all: phase('tat-ca'), coSan: phase('co-san'), taiKhiXem: phase('tai-khi-xem') },
      assign: {
        ok: assignActs.filter((a) => a.status === 200).length,
        conflict409: assignActs.filter((a) => a.status === 409).length,
        backsAfterAssign: afterAssign.length,
        firstDisplayShowsAssignment: afterAssign.filter((b) => b.firstShowsAssignment).length,
        assignmentVisibleWithinBack: visible.length,
        assignmentVisibleMs: visible.length ? { median: round(median(visible)), max: round(Math.max(...visible)) } : null,
      },
      otherFilterShown: (() => {
        const xs = otherFilter.filter((o) => o.variant === v).map((o) => o.ms);
        return { times: xs.length, totalMs: xs.reduce((a, b) => a + b, 0), maxMs: xs.length ? Math.max(...xs) : null, filterChanges: raw.actions.filter((a) => a.variant === v && a.action === 'filter').length };
      })(),
      errors: raw.meta.errors.filter((e) => variantOf.get(e.uid) === v).length,
    };
  }
  const othersChanges = raw.history.changes.filter((c) => c.by === 'khac').length;
  return {
    meta: {
      name: raw.meta.name,
      startedAt: new Date(raw.meta.startedAt).toISOString(),
      finishedAt: new Date(raw.meta.finishedAt).toISOString(),
      params: raw.meta.params,
      environment: raw.meta.environment,
      powerAtStart: raw.meta.powerAtStart,
      powerSources: raw.meta.powerSources,
      powerChanged: raw.meta.powerChanged,
      machineSleep: raw.meta.machineSleep,
      load1: { min: Math.min(...raw.meta.load.map((s) => s.load1)), max: Math.max(...raw.meta.load.map((s) => s.load1)) },
      battery: { first: raw.meta.load[0]?.batteryPct ?? null, last: raw.meta.load.at(-1)?.batteryPct ?? null },
      errors: raw.meta.errors.length,
      changes: { total: raw.history.changes.length, byOthers: othersChanges, byDispatchers: raw.history.changes.length - othersChanges },
    },
    byVariant,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { writeJson } = await import('./lib');
  const name = process.env.NAME ?? 'hour';
  const dir = resultsDir();
  const raw = JSON.parse(readFileSync(join(dir, `hour-${name}.json`), 'utf8')) as HourRaw;
  const summary = analyzeHour(raw);
  writeJson(join(dir, `hour-${name}-summary.json`), summary);
  console.log(JSON.stringify(summary.byVariant, null, 1));
}
