/**
 * Một lượt đo trang sản phẩm theo mục 5: bật API (tiến trình riêng), khởi động nóng WARMUP_S giây trên chính bản cần đo,
 * xóa cache theo FLUSH (mặc định: bản sau bắt đầu với cache trống), reset pg_stat_statements và thống kê Redis, rồi chạy k6
 * RATE request/phút trong DURATION_S giây (80 % vào 500 id nóng). Mỗi SAMPLE_S giây lấy mẫu: calls của câu trang sản phẩm,
 * counter của app (/metrics), keyspace_hits/misses và bộ nhớ Redis, CPU cgroup của container PostgreSQL và Redis,
 * CPU của tiến trình API (ps), CPU và load của máy ảo Docker.
 * DRILL=redis-outage: 5 pha PHASE_S giây: bình thường → `docker compose stop redis` → `start` → `pause` → `unpause`.
 *   RUN=main NAME=truoc VARIANT=truoc pnpm bench:load
 *   RUN=main NAME=sau-cold VARIANT=sau pnpm bench:load
 *   RUN=main NAME=redis-outage VARIANT=sau DRILL=redis-outage pnpm bench:load
 * Kết quả: bench/results/<RUN>/<NAME>.json (+ <NAME>-k6.json, <NAME>-api.log, <NAME>-k6.log).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { appCounters, benchRedis, containerCpuUsec, dockerVm, processCpuSeconds, productQueryStats, redisInfo, round, run, startApi } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const NAME = process.env.NAME ?? process.env.VARIANT ?? 'sau';
const VARIANT = process.env.VARIANT ?? 'sau';
const DURATION_S = Number(process.env.DURATION_S ?? 600);
const RATE = Number(process.env.RATE ?? 10000);
const WARMUP_S = Number(process.env.WARMUP_S ?? 30);
// FLUSH=after (mặc định): xóa cache sau khởi động nóng, lượt đo bắt đầu với cache trống; before: xóa trước khởi động nóng
// (lượt đo bắt đầu với 500 id nóng đã nằm trong cache); none: giữ nguyên cache (sau bench:memory).
const FLUSH = process.env.FLUSH ?? 'after';
if (!['after', 'before', 'none'].includes(FLUSH)) throw new Error(`FLUSH phải là after, before hoặc none, nhận ${FLUSH}`);
const SAMPLE_S = Number(process.env.SAMPLE_S ?? 10);
const DRILL = process.env.DRILL ?? '';
const PHASE_S = Number(process.env.PHASE_S ?? 60);
const HOT_SHARE = process.env.HOT_SHARE ?? '0.8';
mkdirSync(OUT, { recursive: true });

const db = createDb(loadConfig().databaseUrl, { max: 2 });
const redis = benchRedis();
const products = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM products WHERE id <= 200000`.execute(db)).rows[0]?.n);
if (products < 200_000) throw new Error(`cần seed 200.000 sản phẩm (có ${products}): pnpm db:seed`);

function k6(args: { variant: string; durationS: number; out: string; log: string; phases?: string }) {
  const log = openSync(args.log, 'a');
  const child = spawn(
    'k6',
    ['run', '--quiet', '-e', `VARIANT=${args.variant}`, '-e', `RATE=${RATE}`, '-e', `DURATION=${args.durationS}s`, '-e', `OUT=${args.out}`, '-e', `HOT_SHARE=${HOT_SHARE}`,
      ...(args.phases ? ['-e', `PHASES=${args.phases}`] : []), 'bench/product-page.k6.js'],
    { stdio: ['ignore', log, log] },
  );
  return new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? -1)));
}

const api = await startApi(join(OUT, `${NAME}-api.log`));
try {
  if (FLUSH === 'before') await redis.flushall();
  if (WARMUP_S > 0) {
    const code = await k6({ variant: VARIANT, durationS: WARMUP_S, out: join(OUT, `${NAME}-warmup-k6.json`), log: join(OUT, `${NAME}-k6.log`) });
    if (code !== 0) throw new Error(`k6 khởi động nóng lỗi (mã ${code})`);
  }
  if (FLUSH === 'after') await redis.flushall();
  await sql`SELECT pg_stat_statements_reset()`.execute(db);
  await redis.config('RESETSTAT');

  const samples: Record<string, unknown>[] = [];
  const takeSample = async (label?: string) => {
    const t = Date.now();
    const [pg, pgCpu, redisCpu, vm, apiCpu, rInfo, app] = await Promise.all([
      productQueryStats(db), containerCpuUsec('postgres'), containerCpuUsec('redis'), dockerVm(), processCpuSeconds(api.pid), redisInfo(redis), appCounters(),
    ]);
    samples.push({ t, label, pg, pgCpuUsec: pgCpu, redisCpuUsec: redisCpu, vm, apiCpuS: apiCpu, redis: rInfo, app, hostLoad1: loadavg()[0] });
  };

  // Lịch diễn tập: mốc tuyệt đối (epoch ms) dùng chung cho k6 (gắn pha cho request) và cho lệnh docker.
  const t0 = Date.now() + 2_000;
  const plan = DRILL === 'redis-outage'
    ? [
        { name: 'normal', at: 0, cmd: null },
        { name: 'stop', at: t0 + PHASE_S * 1000, cmd: ['compose', 'stop', 'redis'] },
        { name: 'restarted', at: t0 + 2 * PHASE_S * 1000, cmd: ['compose', 'start', 'redis'] },
        { name: 'pause', at: t0 + 3 * PHASE_S * 1000, cmd: ['compose', 'pause', 'redis'] },
        { name: 'unpaused', at: t0 + 4 * PHASE_S * 1000, cmd: ['compose', 'unpause', 'redis'] },
      ]
    : [];
  const durationS = DRILL ? 5 * PHASE_S + 2 : DURATION_S;
  const actions: { name: string; plannedAt: number; startedAt: number; endedAt: number; ok: boolean; output: string }[] = [];

  await takeSample('start');
  const k6Start = Date.now();
  const k6Done = k6({ variant: VARIANT, durationS, out: join(OUT, `${NAME}-k6.json`), log: join(OUT, `${NAME}-k6.log`), phases: plan.map((p) => `${p.name}:${p.at}`).join(',') || undefined });
  let finished = false;
  void k6Done.then(() => (finished = true));

  const drill = (async () => {
    for (const step of plan.filter((p) => p.cmd)) {
      await sleep(Math.max(0, step.at - Date.now()));
      const startedAt = Date.now();
      try {
        const output = await run('docker', step.cmd!);
        actions.push({ name: step.name, plannedAt: step.at, startedAt, endedAt: Date.now(), ok: true, output: output.trim() });
      } catch (err) {
        actions.push({ name: step.name, plannedAt: step.at, startedAt, endedAt: Date.now(), ok: false, output: (err as Error).message });
      }
    }
  })();
  while (!finished) {
    await Promise.race([sleep(SAMPLE_S * 1000), k6Done]);
    if (!finished) await takeSample();
  }
  const code = await k6Done;
  await drill;
  await takeSample('end');
  const k6End = Date.now();
  if (code !== 0) throw new Error(`k6 lỗi (mã ${code}), xem ${NAME}-k6.log`);

  // ---- Tổng hợp ----
  type S = { t: number; pg: { calls: number; totalExecMs: number }; pgCpuUsec: number | null; redisCpuUsec: number | null; vm: { idle: number; total: number; load1: number }; apiCpuS: number | null; redis: { hits: number; misses: number; usedMemory: number; keys: number } | null; app: Record<string, number> | null };
  const ss = samples as unknown as S[];
  const first = ss[0]!;
  const last = ss[ss.length - 1]!;
  const seconds = (last.t - first.t) / 1000;
  const counter = (s: S, key: string) => s.app?.[key] ?? 0;
  const lookups = (s: S) => ({
    hit: counter(s, 'product_cache_lookups_total{result="hit"}'),
    miss: counter(s, 'product_cache_lookups_total{result="miss"}'),
    error: counter(s, 'product_cache_lookups_total{result="error"}'),
    negative: counter(s, 'product_cache_lookups_total{result="negative_hit"}'),
  });
  const delta = (a: S, b: S) => {
    const la = lookups(a);
    const lb = lookups(b);
    const hit = lb.hit - la.hit;
    const all = hit + (lb.miss - la.miss) + (lb.error - la.error) + (lb.negative - la.negative);
    return { dbCalls: b.pg.calls - a.pg.calls, hit, lookups: all, hitRatio: all ? hit / all : null, seconds: (b.t - a.t) / 1000 };
  };
  // Theo từng phút kể từ lúc k6 bắt đầu: hiệu giữa hai mẫu gần mốc đầu phút và cuối phút nhất.
  const nearest = (at: number) => ss.reduce((best, s) => (Math.abs(s.t - at) < Math.abs(best.t - at) ? s : best));
  const perMinute: { minute: number; seconds: number; dbCalls: number; dbCallsPerMin: number; hitRatio: number | null }[] = [];
  for (let m = 0; (m + 1) * 60 <= seconds + SAMPLE_S / 2; m++) {
    const a = nearest(k6Start + m * 60_000);
    const b = nearest(k6Start + (m + 1) * 60_000);
    if (b.t <= a.t) continue;
    const d = delta(a, b);
    perMinute.push({ minute: m + 1, seconds: round(d.seconds, 1), dbCalls: d.dbCalls, dbCallsPerMin: round((d.dbCalls / d.seconds) * 60, 0), hitRatio: d.hitRatio === null ? null : round(d.hitRatio * 100, 2) });
  }
  // CPU của container: cộng các khoảng giữa hai mẫu liên tiếp có số đọc được (Redis dừng thì không đọc được,
  // khởi động lại thì bộ đếm của cgroup về 0 nên bỏ khoảng có hiệu âm).
  const cpuPctOf = (key: 'pgCpuUsec' | 'redisCpuUsec') => {
    let usec = 0;
    let covered = 0;
    for (let i = 1; i < ss.length; i++) {
      const a = ss[i - 1]![key];
      const b = ss[i]![key];
      if (a === null || b === null || b < a) continue;
      usec += b - a;
      covered += (ss[i]!.t - ss[i - 1]!.t) / 1000;
    }
    return covered ? { pct: round((usec / 1e6 / covered) * 100, 1), coveredSeconds: round(covered, 1) } : null;
  };
  const total = delta(first, last);
  const k6Summary = JSON.parse(readFileSync(join(OUT, `${NAME}-k6.json`), 'utf8'));
  const m = k6Summary.metrics;
  const trend = (name: string) => (m[name] ? { count: m[name].count, p50: round(m[name].med, 2), p95: round(m[name]['p(95)'], 2), p99: round(m[name]['p(99)'], 2), max: round(m[name].max, 2) } : null);
  const result = {
    name: NAME,
    variant: VARIANT,
    drill: DRILL || null,
    env: { RATE, DURATION_S: durationS, WARMUP_S, FLUSH, SAMPLE_S, HOT_SHARE, PHASE_S: DRILL ? PHASE_S : null, products },
    window: { seconds: round(seconds, 1), k6Seconds: round((k6End - k6Start) / 1000, 1) },
    requests: m.http_reqs?.count ?? 0,
    non200: m.page_non200?.count ?? 0,
    server5xx: m.page_5xx?.count ?? 0,
    droppedIterations: m.dropped_iterations?.count ?? 0,
    latencyMs: trend('http_req_duration'),
    latencyBySourceMs: Object.fromEntries(['hit', 'miss', 'bypass', 'none'].map((s) => [s, trend(`page_${s}_ms`)]).filter(([, v]) => v)),
    phases: plan.length
      ? plan.map((p) => ({ name: p.name, latencyMs: trend(`phase_${p.name}_ms`), edgeLatencyMs: trend(`phase_${p.name}_edge_ms`), non200: m[`phase_${p.name}_non200`]?.count ?? 0 }))
      : undefined,
    actions: actions.map((a) => ({ ...a, secondsAfterK6Start: round((a.startedAt - k6Start) / 1000, 1), tookMs: a.endedAt - a.startedAt })),
    db: {
      productQueryCalls: total.dbCalls,
      productQueryCallsPerMin: round((total.dbCalls / seconds) * 60, 0),
      callsPerRequestPct: m.http_reqs?.count ? round((total.dbCalls / m.http_reqs.count) * 100, 2) : null,
      productQueryMeanExecMs: total.dbCalls ? round((last.pg.totalExecMs - first.pg.totalExecMs) / total.dbCalls, 4) : null,
    },
    cache: {
      appHitRatioPct: total.hitRatio === null ? null : round(total.hitRatio * 100, 2),
      appLookups: { ...Object.fromEntries(Object.entries(lookups(last)).map(([k, v]) => [k, v - (lookups(first) as Record<string, number>)[k]!])) },
      redisKeyspace: first.redis && last.redis ? { hits: last.redis.hits - first.redis.hits, misses: last.redis.misses - first.redis.misses } : null,
      redisUsedMemoryMbEnd: last.redis ? round(last.redis.usedMemory / 1024 / 1024, 1) : null,
      redisKeysEnd: last.redis?.keys ?? null,
    },
    perMinute,
    cpuPct: {
      postgres: cpuPctOf('pgCpuUsec'),
      redis: cpuPctOf('redisCpuUsec'),
      api: first.apiCpuS === null || last.apiCpuS === null ? null : round(((last.apiCpuS - first.apiCpuS) / seconds) * 100, 1),
      dockerVmBusy: round((1 - (last.vm.idle - first.vm.idle) / (last.vm.total - first.vm.total)) * 100, 1),
    },
    load: { dockerVmLoad1Start: first.vm.load1, dockerVmLoad1Max: Math.max(...ss.map((s) => s.vm.load1)), hostLoad1Start: round(loadavg()[0] ?? 0, 2) },
  };
  writeFileSync(join(OUT, `${NAME}.json`), JSON.stringify({ ...result, samples }, null, 2));
  const { perMinute: _pm, ...brief } = result;
  console.log(JSON.stringify(brief, null, 1));
} finally {
  await api.stop();
  redis.disconnect();
  await db.destroy();
}
