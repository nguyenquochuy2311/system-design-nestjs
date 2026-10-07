/**
 * Một lượt đo theo mục 5, cho một bản (VARIANT=truoc|sau):
 * - đưa DB về seed, xóa sạch Redis, reset pg_stat_statements và thống kê Redis;
 * - bật API (tiến trình riêng, ghi nhật ký câu trả lời có sản phẩm đang theo dõi), job khuyến mãi, và worker (bản sau);
 * - k6 đọc ba loại trang RATE request/phút trong DURATION_S giây (bench/page-mix.k6.js, chuỗi request tất định);
 * - SCENARIO=staleness (mặc định): CHANGES lần đổi giá, mỗi lần một sản phẩm nóng khác nhau, xoay vòng ba đường ghi
 *   admin → csv → promo, lần thứ i ở giây CHANGE_START_S + i·CHANGE_EVERY_S. Sau mỗi lần (PROBE=1): poll các trang chứa
 *   sản phẩm mỗi 100 ms trong 10 giây đầu, mỗi 1 s tới giây 60, rồi mỗi 5 s; đặt đơn ở giây +2 và +10;
 * - SCENARIO=bulk: ở giây BULK_AT_S, job CSV đổi giá BULK_SIZE sản phẩm trong một transaction; poll trang của 10 sản phẩm.
 * Mỗi giây lấy số sự kiện outbox tồn đọng; mỗi SAMPLE_S giây: pg_stat_statements theo nhóm, Redis INFO, counter của API,
 * CPU cgroup của PostgreSQL và Redis, CPU các tiến trình, load của máy ảo Docker và của macOS.
 *   RUN=main NAME=staleness-truoc VARIANT=truoc pnpm bench:scenario
 *   RUN=main NAME=staleness-sau VARIANT=sau pnpm bench:scenario
 *   RUN=main NAME=bulk-sau VARIANT=sau SCENARIO=bulk pnpm bench:scenario
 * Kết quả: bench/results/<RUN>/<NAME>.json (+ -k6.json, -watch.ndjson, -api.log, -worker.log, -promo.log, -k6.log).
 */
import { spawn } from 'node:child_process';
import { createReadStream, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import pg from 'pg';
import { loadConfig, num } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import type { PageKind, Variant } from '../src/shared/pages';
import {
  appCounters,
  BASE,
  benchRedis,
  containerCpuUsec,
  dist,
  dockerVm,
  hash32,
  pgStatements,
  processCpuSeconds,
  redisInfo,
  reseed,
  round,
  startProc,
  sumCounter,
  waitHttp,
  type Proc,
} from './lib';

const RUN = process.env.RUN ?? 'main';
const OUT = join('bench/results', RUN);
const VARIANT = (process.env.VARIANT ?? 'sau') as Variant;
if (VARIANT !== 'truoc' && VARIANT !== 'sau') throw new Error(`VARIANT phải là truoc hoặc sau, nhận ${VARIANT}`);
const SCENARIO = process.env.SCENARIO ?? 'staleness';
if (SCENARIO !== 'staleness' && SCENARIO !== 'bulk') throw new Error(`SCENARIO phải là staleness hoặc bulk, nhận ${SCENARIO}`);
const NAME = process.env.NAME ?? `${SCENARIO}-${VARIANT}`;
const DURATION_S = num('DURATION_S', SCENARIO === 'bulk' ? 360 : 1080);
const RATE = num('RATE', 10_000);
const CHANGES = num('CHANGES', 100);
const CHANGE_START_S = num('CHANGE_START_S', 60);
const CHANGE_EVERY_S = num('CHANGE_EVERY_S', 6);
const BULK_AT_S = num('BULK_AT_S', 120);
const BULK_SIZE = num('BULK_SIZE', 2_000);
const PROBE = process.env.PROBE !== '0';
const PAGE_TTL_S = num('PAGE_TTL_S', 900);
const SEED = num('SEED', 1);
const SAMPLE_S = num('SAMPLE_S', 10);
const WARMUP_S = 60; // phút đầu: cache đang nạp lần đầu, tách riêng khi tính hit ratio
mkdirSync(OUT, { recursive: true });
const file = (suffix: string) => join(OUT, `${NAME}${suffix}`);

type Path = 'admin' | 'csv' | 'promo';
const PATHS: Path[] = ['admin', 'csv', 'promo'];
interface PageRef {
  kind: PageKind;
  url: string;
  key: string;
}
interface Change {
  i: number;
  path: Path;
  id: number;
  plannedAt: number;
  oldPrice: number;
  newPrice: number;
  pages: PageRef[];
  probe: boolean;
  tRef?: number;
  writeMs?: number;
  polls?: { kind: PageKind; key: string; freshMs: number | null; polls: number; bypassFresh: number }[];
  orders?: ({ delayMs: number; chargedPrice: number; matchesNew: boolean } | null)[];
}

const config = loadConfig();
const db = createDb(config.databaseUrl, { max: 3 });
const redis = benchRedis();
const csvClient = new pg.Client({ connectionString: config.databaseUrl });
const procs: Proc[] = [];

// ---- Chuẩn bị dữ liệu và kế hoạch đổi giá ----
await reseed();
const { rows: meta } = await sql<{ id: number; category: string; page: number; list_price: number }>`
  SELECT id, category, ((row_number() OVER (PARTITION BY category ORDER BY id) - 1) / 20 + 1)::int AS page, list_price
  FROM products`.execute(db);
const byId = new Map(meta.map((m) => [m.id, m]));
const deals = (await db.selectFrom('home_deals').select('product_id').orderBy('position').execute()).map((d) => d.product_id);
const dealSet = new Set(deals);
const shuffled = (ids: number[]) => [...ids].sort((a, b) => hash32(a ^ SEED) - hash32(b ^ SEED));
const roundTo1000 = (x: number) => Math.round(x / 1000) * 1000;
const pagesOf = (id: number): PageRef[] => {
  const m = byId.get(id)!;
  const refs: PageRef[] = [
    { kind: 'product', url: `/${VARIANT}/products/${id}`, key: `${VARIANT}:product:v1:${id}` },
    { kind: 'category', url: `/${VARIANT}/categories/${m.category}?page=${m.page}`, key: `${VARIANT}:category:v1:${m.category}:p${m.page}` },
  ];
  if (dealSet.has(id)) refs.push({ kind: 'home', url: `/${VARIANT}/home/deals`, key: `${VARIANT}:home:v1:deals` });
  return refs;
};

const t0 = Date.now() + 3_000; // mốc 0 của lượt: lúc k6 bắt đầu
const runEndAt = t0 + DURATION_S * 1000;
const changes: Change[] = [];
if (SCENARIO === 'staleness') {
  // Sản phẩm nóng (id 1–600, nằm ở trang 1–5 của mỗi danh mục); 12 sản phẩm "deal hôm nay" đi đường khuyến mãi.
  const hot = shuffled(meta.filter((m) => m.id <= 600 && !dealSet.has(m.id)).map((m) => m.id));
  const dealQueue = [...deals];
  for (let i = 0; i < CHANGES; i++) {
    const path = PATHS[i % 3]!;
    const id = path === 'promo' && dealQueue.length ? dealQueue.shift()! : hot.shift()!;
    const old = byId.get(id)!.list_price;
    const newPrice = path === 'admin' ? roundTo1000(old * 0.9) : path === 'csv' ? roundTo1000(old * 1.05) : roundTo1000(old * 0.5);
    changes.push({ i, path, id, plannedAt: t0 + (CHANGE_START_S + i * CHANGE_EVERY_S) * 1000, oldPrice: old, newPrice, pages: pagesOf(id), probe: PROBE });
  }
} else {
  const hotIds = shuffled(meta.filter((m) => m.id <= 600).map((m) => m.id));
  const tail = shuffled(meta.filter((m) => m.id > 600).map((m) => m.id)).slice(0, Math.max(0, BULK_SIZE - 600));
  const ids = [...meta.filter((m) => m.id <= 600).map((m) => m.id), ...tail].slice(0, BULK_SIZE);
  // Theo dõi 60 sản phẩm (12 deal, 24 nóng, 24 đuôi); poll trang của 10 sản phẩm (4 deal, 6 nóng).
  const watchedHot = hotIds.filter((id) => !dealSet.has(id)).slice(0, 24);
  const watched = new Set([...deals, ...watchedHot, ...tail.slice(0, 24)]);
  const probed = new Set([...deals.slice(0, 4), ...watchedHot.slice(0, 6)]);
  for (const [i, id] of ids.entries()) {
    const old = byId.get(id)!.list_price;
    changes.push({ i, path: 'csv', id, plannedAt: t0 + BULK_AT_S * 1000, oldPrice: old, newPrice: roundTo1000(old * 0.95), pages: pagesOf(id), probe: PROBE && probed.has(id) });
    if (!watched.has(id)) changes[changes.length - 1]!.pages = [];
  }
}
const watchIds = changes.filter((c) => c.pages.length).map((c) => c.id);

// Lịch khuyến mãi đặt sẵn: job tự áp lúc starts_at (đồng hồ host, cùng đồng hồ với script này).
const promos = changes.filter((c) => c.path === 'promo');
if (promos.length) {
  await db
    .insertInto('promotions')
    .values(promos.map((c) => ({ product_id: c.id, promo_price: c.newPrice, starts_at: new Date(c.plannedAt), ends_at: new Date(c.plannedAt + 86_400_000) })))
    .execute();
}
await redis.flushall();
await redis.config('RESETSTAT');
await sql`SELECT pg_stat_statements_reset()`.execute(db);
await csvClient.connect();
const csvSql = readFileSync(`sql/${VARIANT}/import-prices.sql`, 'utf8');

// Độ lệch đồng hồ DB (máy ảo Docker) so với host, để đổi price_changed_at của job khuyến mãi về giờ host.
const before = Date.now();
const dbNow = Number((await sql<{ ms: number }>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`.execute(db)).rows[0]!.ms);
const clockOffsetMs = dbNow - (before + Date.now()) / 2;

// ---- Tiến trình ----
const api = startProc('api', 'src/main.ts', file('-api.log'), {
  PORT: '3100',
  PAGE_TTL_S: String(PAGE_TTL_S),
  WATCH_IDS: watchIds.join(','),
  WATCH_LOG: file('-watch.ndjson'),
});
procs.push(api);
procs.push(startProc('promo', 'src/promo-job.ts', file('-promo.log'), { VARIANT }));
if (VARIANT === 'sau') procs.push(startProc('worker', 'src/worker.ts', file('-worker.log')));
await waitHttp(`${BASE}/health`);

// ---- Lấy mẫu ----
const fast: { t: number; pending: number }[] = [];
const samples: Record<string, unknown>[] = [];
const takeSample = async (label?: string) => {
  const t = Date.now();
  const [pgs, pgCpu, redisCpu, vm, rInfo, app, cpus] = await Promise.all([
    pgStatements(db),
    containerCpuUsec('postgres'),
    containerCpuUsec('redis'),
    dockerVm(),
    redisInfo(redis),
    appCounters(),
    Promise.all(procs.map(async (p) => [p.name, await processCpuSeconds(p.pid)] as const)),
  ]);
  samples.push({ t, label, pg: pgs, pgCpuUsec: pgCpu, redisCpuUsec: redisCpu, vm, redis: rInfo, app, procCpuS: Object.fromEntries(cpus), hostLoad1: round(loadavg()[0] ?? 0, 2) });
};
let stopSampling = false;
const fastLoop = (async () => {
  while (!stopSampling) {
    const t = Date.now();
    const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM price_outbox WHERE processed_at IS NULL`.execute(db);
    fast.push({ t, pending: rows[0]!.n });
    await sleep(Math.max(0, 1_000 - (Date.now() - t)));
  }
})();

// ---- k6 ----
await sleep(Math.max(0, t0 - Date.now()));
await takeSample('start');
const k6Log = openSync(file('-k6.log'), 'a');
const k6 = spawn('k6', ['run', '--quiet', '-e', `VARIANT=${VARIANT}`, '-e', `RATE=${RATE}`, '-e', `DURATION=${DURATION_S}s`, '-e', `SEED=${SEED}`, '-e', `OUT=${file('-k6.json')}`, 'bench/page-mix.k6.js'], { stdio: ['ignore', k6Log, k6Log] });
const k6Done = new Promise<number>((resolve) => k6.once('exit', (code) => resolve(code ?? -1)));
let k6Finished = false;
void k6Done.then(() => (k6Finished = true));
const sampleLoop = (async () => {
  while (!k6Finished) {
    await Promise.race([sleep(SAMPLE_S * 1000), k6Done]);
    if (!k6Finished) await takeSample();
  }
})();

// ---- Đổi giá, poll, đặt đơn ----
const probeHeaders = { 'content-type': 'application/json', 'x-client': 'probe' };
async function priceOn(ref: PageRef, id: number): Promise<{ price: number | undefined; source: string | null }> {
  try {
    const res = await fetch(`${BASE}${ref.url}`, { headers: probeHeaders });
    const body = (await res.json()) as { price?: number; items?: { id: number; price: number }[] };
    return { price: ref.kind === 'product' ? body.price : body.items?.find((x) => x.id === id)?.price, source: res.headers.get('x-cache') };
  } catch {
    return { price: undefined, source: null };
  }
}
async function poll(c: Change, ref: PageRef) {
  let polls = 0;
  let bypassFresh = 0;
  for (;;) {
    if (Date.now() > runEndAt) return { kind: ref.kind, key: ref.key, freshMs: null, polls, bypassFresh };
    const { price, source } = await priceOn(ref, c.id);
    polls++;
    const t = Date.now();
    // BYPASS (Redis lỗi/quá 50 ms, đọc thẳng DB) mang giá mới nhưng không nói gì về cache: chưa tính là đã làm mới.
    if (price === c.newPrice && source === 'BYPASS') bypassFresh++;
    else if (price === c.newPrice) return { kind: ref.kind, key: ref.key, freshMs: t - c.tRef!, polls, bypassFresh };
    const age = t - c.tRef!;
    await sleep(age < 10_000 ? 100 : age < 60_000 ? 1_000 : 5_000);
  }
}
async function orderAt(c: Change, delayMs: number) {
  await sleep(Math.max(0, c.tRef! + delayMs - Date.now()));
  if (Date.now() > runEndAt) return null;
  const res = await fetch(`${BASE}/${VARIANT}/orders`, { method: 'POST', headers: probeHeaders, body: JSON.stringify({ productId: c.id }) });
  const body = (await res.json()) as { chargedPrice: number };
  return { delayMs, chargedPrice: body.chargedPrice, matchesNew: body.chargedPrice === c.newPrice };
}
async function csvImport(rows: Change[]) {
  await csvClient.query('INSERT INTO price_import (product_id, new_price) SELECT * FROM unnest($1::int[], $2::bigint[])', [rows.map((c) => c.id), rows.map((c) => c.newPrice)]);
  await csvClient.query(csvSql); // đúng file SQL của job, giao thức simple query như psql -f
}
async function probe(c: Change) {
  if (!c.probe) return;
  const [polls, orders] = await Promise.all([
    Promise.all(c.pages.map((ref) => poll(c, ref))),
    SCENARIO === 'staleness' ? Promise.all([orderAt(c, 2_000), orderAt(c, 10_000)]) : Promise.resolve(undefined),
  ]);
  c.polls = polls;
  c.orders = orders;
}

const tasks: Promise<void>[] = [];
if (SCENARIO === 'staleness') {
  for (const c of changes) {
    await sleep(Math.max(0, c.plannedAt - Date.now()));
    const started = Date.now();
    if (c.path === 'admin') {
      const res = await fetch(`${BASE}/${VARIANT}/admin/products/${c.id}/price`, { method: 'PATCH', headers: probeHeaders, body: JSON.stringify({ price: c.newPrice }) });
      if (!res.ok) throw new Error(`PATCH ${c.id} trả ${res.status}`);
    } else if (c.path === 'csv') {
      await csvImport([c]);
    }
    // Đường admin/csv: mốc là lúc lệnh ghi trả về (đã commit). Khuyến mãi: mốc là giờ bắt đầu trong lịch.
    c.tRef = c.path === 'promo' ? c.plannedAt : Date.now();
    c.writeMs = Date.now() - started;
    tasks.push(probe(c));
  }
} else {
  await sleep(Math.max(0, t0 + BULK_AT_S * 1000 - Date.now()));
  const started = Date.now();
  await csvImport(changes);
  const committed = Date.now();
  for (const c of changes) {
    c.tRef = committed;
    c.writeMs = committed - started;
    tasks.push(probe(c));
  }
}
const k6Code = await k6Done;
await sampleLoop;
await Promise.all(tasks);
await takeSample('end');
stopSampling = true;
await fastLoop;
for (const p of [...procs].reverse()) await p.stop();
await csvClient.end();
if (k6Code !== 0) throw new Error(`k6 lỗi (mã ${k6Code}), xem ${NAME}-k6.log`);

// ---- Tổng hợp ----
type Sample = {
  t: number;
  pg: Record<string, { calls: number; totalMs: number }>;
  pgCpuUsec: number | null;
  redisCpuUsec: number | null;
  vm: { idle: number; total: number; load1: number } | null;
  redis: { hits: number; misses: number; evicted: number; usedMemory: number; keys: number } | null;
  app: Record<string, number> | null;
  procCpuS: Record<string, number | null>;
  hostLoad1: number;
};
const ss = samples as unknown as Sample[];
const first = ss[0]!;
const last = ss[ss.length - 1]!;
const nearest = (at: number) => ss.reduce((best, s) => (Math.abs(s.t - at) < Math.abs(best.t - at) ? s : best));
const warm = nearest(t0 + WARMUP_S * 1000);

const lookups = (s: Sample, match: Record<string, string>) => ({
  hit: sumCounter(s.app, 'page_cache_lookups_total', { ...match, result: 'hit' }),
  miss: sumCounter(s.app, 'page_cache_lookups_total', { ...match, result: 'miss' }),
  error: sumCounter(s.app, 'page_cache_lookups_total', { ...match, result: 'error' }),
});
function hitRatio(a: Sample, b: Sample, match: Record<string, string>) {
  const la = lookups(a, match);
  const lb = lookups(b, match);
  const hit = lb.hit - la.hit;
  const miss = lb.miss - la.miss;
  const error = lb.error - la.error;
  const all = hit + miss + error;
  return { lookups: all, hit, miss, error, hitRatioPct: all ? round((hit / all) * 100, 2) : null };
}
const dbReads = (a: Sample, b: Sample, match: Record<string, string>) =>
  sumCounter(b.app, 'page_db_reads_total', match) - sumCounter(a.app, 'page_db_reads_total', match);
const pgCalls = (a: Sample, b: Sample) => Object.fromEntries(Object.keys(b.pg).map((k) => [k, { calls: b.pg[k]!.calls - (a.pg[k]?.calls ?? 0), totalMs: round(b.pg[k]!.totalMs - (a.pg[k]?.totalMs ?? 0), 1) }]));
function cpuPct(key: 'pgCpuUsec' | 'redisCpuUsec', from = 0) {
  let usec = 0;
  let covered = 0;
  for (let i = from + 1; i < ss.length; i++) {
    const a = ss[i - 1]![key];
    const b = ss[i]![key];
    if (a === null || b === null || b < a) continue; // container khởi động lại thì bộ đếm về 0 (bài 03/01)
    usec += b - a;
    covered += (ss[i]!.t - ss[i - 1]!.t) / 1000;
  }
  return covered ? round((usec / 1e6 / covered) * 100, 1) : null;
}
const procCpu = (name: string) => {
  const a = first.procCpuS[name];
  const b = last.procCpuS[name];
  return a == null || b == null ? null : round(((b - a) / ((last.t - first.t) / 1000)) * 100, 1);
};
const seconds = (a: Sample, b: Sample) => (b.t - a.t) / 1000;
const perMin = (n: number, a: Sample, b: Sample) => round((n / seconds(a, b)) * 60, 0);

// Theo từng khoảng lấy mẫu: số lần dựng trang từ DB mỗi giây và hit ratio của tải k6; tồn đọng outbox lớn nhất.
const series = ss.slice(1).map((s, i) => {
  const a = ss[i]!;
  const hr = hitRatio(a, s, { client: 'load' });
  return {
    tS: round((s.t - t0) / 1000, 0),
    dbReadsPerS: round(dbReads(a, s, {}) / seconds(a, s), 1),
    loadHitRatioPct: hr.hitRatioPct,
    pendingMax: Math.max(0, ...fast.filter((f) => f.t > a.t && f.t <= s.t).map((f) => f.pending)),
    hostLoad1: s.hostLoad1,
  };
});

// Độ cũ đo bằng poll: mỗi trang và cả lần đổi (trang chậm nhất).
const probed = changes.filter((c) => c.polls);
const changeStaleness = probed.map((c) => {
  const fresh = c.polls!.map((p) => p.freshMs);
  return { path: c.path, allFreshMs: fresh.some((x) => x === null) ? null : Math.max(...(fresh as number[])) };
});
const staleness = {
  byPath: Object.fromEntries(
    PATHS.map((path) => {
      const xs = changeStaleness.filter((x) => x.path === path);
      const done = xs.map((x) => x.allFreshMs).filter((x): x is number => x !== null);
      return [path, { changes: xs.length, freshByEnd: done.length, within5s: done.filter((x) => x <= 5_000).length, allPagesMs: dist(done) }];
    }).filter(([, v]) => (v as { changes: number }).changes > 0),
  ),
  all: (() => {
    const done = changeStaleness.map((x) => x.allFreshMs).filter((x): x is number => x !== null);
    return { changes: changeStaleness.length, freshByEnd: done.length, within5s: done.filter((x) => x <= 5_000).length, allPagesMs: dist(done) };
  })(),
  byPage: Object.fromEntries(
    (['product', 'category', 'home'] as const).map((kind) => {
      const ps = probed.flatMap((c) => c.polls!.filter((p) => p.kind === kind).map((p) => ({ path: c.path, freshMs: p.freshMs })));
      return [kind, Object.fromEntries(PATHS.map((path) => {
        const done = ps.filter((p) => p.path === path).map((p) => p.freshMs).filter((x): x is number => x !== null);
        return [path, { pages: ps.filter((p) => p.path === path).length, freshByEnd: done.length, within5s: done.filter((x) => x <= 5_000).length, ms: dist(done) }];
      }))];
    }),
  ),
  polls: probed.reduce((a, c) => a + c.polls!.reduce((b, p) => b + p.polls, 0), 0),
  bypassFreshPolls: probed.reduce((a, c) => a + c.polls!.reduce((b, p) => b + p.bypassFresh, 0), 0),
};

// Nhật ký câu trả lời: request nào trả giá cũ (giá trước lần đổi, ở thời điểm sau mốc của lần đổi đó).
const changeById = new Map(changes.filter((c) => c.pages.length).map((c) => [c.id, c]));
const freshAt = new Map<string, number>(); // "<id>|<key>" → lúc poll thấy giá mới
for (const c of probed) for (const p of c.polls!) if (p.freshMs !== null) freshAt.set(`${c.id}|${p.key}`, c.tRef! + p.freshMs);
const watch = {
  lines: { load: 0, probe: 0 },
  staleResponses: { load: { product: 0, category: 0, home: 0 }, probe: { product: 0, category: 0, home: 0 } } as Record<string, Record<PageKind, number>>,
  staleAfterProbeSawFresh: 0,
  lastStaleLoadMsByPath: { admin: [] as number[], csv: [] as number[], promo: [] as number[] },
};
const lastStaleLoad = new Map<number, number>();
const rl = createInterface({ input: createReadStream(file('-watch.ndjson')), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const { t, k, c: client, p } = JSON.parse(line) as { t: number; k: string; c: 'load' | 'probe'; p: Record<string, number> };
  watch.lines[client]++;
  const kind: PageKind = k.includes(':product:') ? 'product' : k.includes(':category:') ? 'category' : 'home';
  let stale = false;
  for (const [idText, price] of Object.entries(p)) {
    const ch = changeById.get(Number(idText));
    if (!ch?.tRef || t < ch.tRef || price !== ch.oldPrice) continue;
    stale = true;
    const seenFresh = freshAt.get(`${ch.id}|${k}`);
    if (seenFresh !== undefined && t > seenFresh) watch.staleAfterProbeSawFresh++;
    if (client === 'load') lastStaleLoad.set(ch.id, Math.max(lastStaleLoad.get(ch.id) ?? 0, t - ch.tRef));
  }
  if (stale) watch.staleResponses[client]![kind]++;
}
for (const c of changes) if (c.pages.length && SCENARIO === 'staleness') watch.lastStaleLoadMsByPath[c.path].push(lastStaleLoad.get(c.id) ?? 0);

const k6Summary = JSON.parse(readFileSync(file('-k6.json'), 'utf8')) as { metrics: Record<string, Record<string, number>> };
const m = k6Summary.metrics;
const trend = (name: string) => (m[name] ? { count: m[name].count, p50: round(m[name].med!, 2), p95: round(m[name]['p(95)']!, 2), p99: round(m[name]['p(99)']!, 2), max: round(m[name].max!, 2) } : null);
const k6Requests = m.http_reqs?.count ?? 0;
const k6ByPage = { product: m.page_product_ms?.count ?? 0, category: m.page_category_ms?.count ?? 0, home: m.page_home_ms?.count ?? 0 };
const staleLoadTotal = Object.values(watch.staleResponses.load!).reduce((a, b) => a + b, 0);

// Outbox, đơn hàng, độ trễ áp giá của job khuyến mãi (đổi giờ DB về giờ host).
const outboxRows = await db.selectFrom('price_outbox').select(['source', 'created_at', 'processed_at', 'keys_targeted']).execute();
const lagMs = outboxRows.filter((r) => r.processed_at).map((r) => r.processed_at!.getTime() - r.created_at.getTime());
const orders = await db.selectFrom('orders').select(['charged_price', 'db_price']).execute();
const promoApplied = promos.length
  ? await db.selectFrom('products').select(['id', 'price_changed_at']).where('id', 'in', promos.map((c) => c.id)).execute()
  : [];
const promoLagMs = promoApplied.map((r) => r.price_changed_at.getTime() - clockOffsetMs - changes.find((c) => c.id === r.id)!.plannedAt);
const probeOrders = probed.flatMap((c) => (c.orders ?? []).filter((o): o is NonNullable<typeof o> => o !== null).map((o) => ({ ...o, path: c.path })));

const result = {
  name: NAME,
  variant: VARIANT,
  scenario: SCENARIO,
  env: { RATE, DURATION_S, CHANGES: SCENARIO === 'staleness' ? CHANGES : null, CHANGE_START_S, CHANGE_EVERY_S, BULK_AT_S: SCENARIO === 'bulk' ? BULK_AT_S : null, BULK_SIZE: SCENARIO === 'bulk' ? BULK_SIZE : null, PROBE, PAGE_TTL_S, SEED, SAMPLE_S, WARMUP_S },
  t0,
  clockOffsetMs: round(clockOffsetMs, 1),
  k6: { requests: k6Requests, byPage: k6ByPage, non200: (m.page_product_non200?.count ?? 0) + (m.page_category_non200?.count ?? 0) + (m.page_home_non200?.count ?? 0), server5xx: m.page_5xx?.count ?? 0, droppedIterations: m.dropped_iterations?.count ?? 0, latencyMs: trend('http_req_duration'), bySourceMs: { hit: trend('source_hit_ms'), miss: trend('source_miss_ms'), bypass: trend('source_bypass_ms') } },
  hitRatio: {
    loadWhole: hitRatio(first, last, { client: 'load' }),
    loadAfterWarmup: hitRatio(warm, last, { client: 'load' }),
    allClientsAfterWarmup: hitRatio(warm, last, {}),
    loadAfterWarmupByPage: Object.fromEntries((['product', 'category', 'home'] as const).map((page) => [page, hitRatio(warm, last, { client: 'load', page })])),
    redisKeyspace: first.redis && last.redis ? { hits: last.redis.hits - first.redis.hits, misses: last.redis.misses - first.redis.misses } : null,
  },
  db: {
    pageReadsWhole: dbReads(first, last, {}),
    pageReadsAfterWarmup: dbReads(warm, last, {}),
    pageReadsPerMinAfterWarmup: perMin(dbReads(warm, last, {}), warm, last),
    loadPageReadsPerMinAfterWarmup: perMin(dbReads(warm, last, { client: 'load' }), warm, last),
    pgStatementsAfterWarmup: pgCalls(warm, last),
    pgStatementsPerMinAfterWarmup: Object.fromEntries(Object.entries(pgCalls(warm, last)).map(([k, v]) => [k, perMin(v.calls, warm, last)])),
  },
  outbox: {
    events: outboxRows.length,
    processed: lagMs.length,
    lagMs: dist(lagMs),
    keysTargeted: dist(outboxRows.filter((r) => r.keys_targeted !== null).map((r) => r.keys_targeted!)),
    pendingMax: Math.max(0, ...fast.map((f) => f.pending)),
    pendingSamples: fast.length,
    pendingNonZeroSamples: fast.filter((f) => f.pending > 0).length,
    drainMs: SCENARIO === 'bulk' && lagMs.length ? Math.max(...lagMs) : null,
  },
  staleness,
  watch: {
    ...watch,
    k6Requests,
    staleLoadTotal,
    staleLoadPct: k6Requests ? round((staleLoadTotal / k6Requests) * 100, 3) : null,
    staleLoadPctByPage: Object.fromEntries((['product', 'category', 'home'] as const).map((k) => [k, k6ByPage[k] ? round((watch.staleResponses.load![k] / k6ByPage[k]) * 100, 3) : null])),
    lastStaleLoadMsByPath: Object.fromEntries(Object.entries(watch.lastStaleLoadMsByPath).map(([k, v]) => [k, dist(v)])),
  },
  orders: {
    total: orders.length,
    chargedNotDbPrice: orders.filter((o) => o.charged_price !== o.db_price).length,
    probe: { total: probeOrders.length, notNewPrice: probeOrders.filter((o) => !o.matchesNew).length, notNewPriceByPath: Object.fromEntries(PATHS.map((p) => [p, probeOrders.filter((o) => o.path === p && !o.matchesNew).length])) },
  },
  promoJob: { applied: promoApplied.length, applyLagMs: dist(promoLagMs) },
  writes: { writeMs: dist(changes.filter((c) => c.writeMs !== undefined && c.path !== 'promo').map((c) => c.writeMs!)) },
  cpuPct: { postgres: cpuPct('pgCpuUsec'), redis: cpuPct('redisCpuUsec'), api: procCpu('api'), worker: procCpu('worker'), promo: procCpu('promo'), dockerVmBusy: first.vm && last.vm ? round((1 - (last.vm.idle - first.vm.idle) / (last.vm.total - first.vm.total)) * 100, 1) : null },
  redisEnd: last.redis ? { usedMemoryMb: round(last.redis.usedMemory / 1024 / 1024, 1), keys: last.redis.keys, evictedKeys: last.redis.evicted - (first.redis?.evicted ?? 0) } : null,
  load: { hostLoad1Min: Math.min(...ss.map((s) => s.hostLoad1)), hostLoad1Max: Math.max(...ss.map((s) => s.hostLoad1)), dockerVmLoad1Max: Math.max(...ss.map((s) => s.vm?.load1 ?? 0)) },
  series,
};
writeFileSync(file('.json'), JSON.stringify({ ...result, changes, samples, fast }, null, 2));
const { series: _s, ...brief } = result;
console.log(JSON.stringify(brief, null, 1));
redis.disconnect();
await db.destroy();
