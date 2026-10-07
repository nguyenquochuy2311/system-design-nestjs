// Phần dùng chung của các script đo: bật/tắt tiến trình (API, worker, job khuyến mãi), đọc số liệu từ PostgreSQL, Redis,
// cgroup của container và /metrics của API.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/shared/db';

const execFileAsync = promisify(execFile);
export const BASE = 'http://127.0.0.1:3100';

export interface Proc {
  name: string;
  child: ChildProcess;
  pid: number;
  stop: () => Promise<void>;
}

/** Chạy một file trong src/ như tiến trình node riêng (giống pnpm dev / pnpm worker), log ra file. */
export function startProc(name: string, entry: string, logFile: string, env: Record<string, string> = {}): Proc {
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', entry], { env: { ...process.env, NO_COLOR: '1', ...env }, stdio: ['ignore', log, log] });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(10_000).then(() => child.kill('SIGKILL'))]);
  };
  process.on('exit', () => child.kill('SIGKILL'));
  return { name, child, pid: child.pid!, stop };
}

export async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // chưa lên
    }
    if (Date.now() > deadline) throw new Error(`không gọi được ${url}`);
    await sleep(200);
  }
}

export const run = async (cmd: string, args: string[]) => (await execFileAsync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;

/** Đưa DB về trạng thái seed (giá ban đầu, outbox/đơn/lịch khuyến mãi trống). */
export const reseed = () => run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', 'shop', '-v', 'ON_ERROR_STOP=1', '-v', 'products=20000', '-f', '/lab/db/seed.sql']);

/** usage_usec trong cgroup v2 của container (cùng nguồn docker stats dùng). null nếu không đọc được. */
export async function containerCpuUsec(service: 'postgres' | 'redis'): Promise<number | null> {
  try {
    const out = await run('docker', ['compose', 'exec', '-T', service, 'cat', '/sys/fs/cgroup/cpu.stat']);
    return Number(/usage_usec (\d+)/.exec(out)?.[1]);
  } catch {
    return null;
  }
}

/** /proc/stat và /proc/loadavg của máy ảo Docker (container dùng chung kernel), nhật ký quyết định bài 02/03. */
export async function dockerVm(): Promise<{ idle: number; total: number; load1: number } | null> {
  try {
    const out = await run('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'head -1 /proc/stat; cat /proc/loadavg']);
    const [statLine = '', loadLine = ''] = out.trim().split('\n');
    const n = statLine.trim().split(/\s+/).slice(1).map(Number);
    return { idle: (n[3] ?? 0) + (n[4] ?? 0), total: n.reduce((a, b) => a + b, 0), load1: Number(loadLine.split(' ')[0]) };
  } catch {
    return null;
  }
}

/** Thời gian CPU đã dùng (giây) của một tiến trình trên host, đọc bằng ps (dạng [phút:]giây.phần trăm). */
export async function processCpuSeconds(pid: number): Promise<number | null> {
  try {
    const out = (await run('ps', ['-o', 'time=', '-p', String(pid)])).trim();
    return out.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
  } catch {
    return null;
  }
}

/** Nhóm câu SQL trong pg_stat_statements theo vai trò để đếm tải DB của từng phần. */
export function classifyQuery(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('pg_stat_statements') || q.includes('pg_stat_activity')) return 'bench';
  if (q.includes('price_outbox') && q.includes('count(')) return 'bench';
  if (q.includes('home_deals')) return 'page_home';
  if (q.includes('"p"."category" = $1')) return 'page_category';
  if (q.includes('from "products" as "p" where "p"."id" = $1')) return 'page_product';
  if (q.includes('insert into orders')) return 'order';
  if (q.includes('price_outbox')) return 'worker_or_outbox';
  if (q.includes('promotions')) return 'promo_job';
  if (q === 'begin' || q === 'commit' || q === 'rollback') return 'tx_control';
  return 'other';
}

export async function pgStatements(db: Kysely<Database>): Promise<Record<string, { calls: number; totalMs: number }>> {
  const { rows } = await sql<{ query: string; calls: number; total_ms: number }>`
    SELECT query, calls::bigint AS calls, total_exec_time::float8 AS total_ms FROM pg_stat_statements`.execute(db);
  const out: Record<string, { calls: number; totalMs: number }> = {};
  for (const r of rows) {
    const k = classifyQuery(r.query);
    const cur = (out[k] ??= { calls: 0, totalMs: 0 });
    cur.calls += Number(r.calls);
    cur.totalMs += Number(r.total_ms);
  }
  return out;
}

export async function redisInfo(redis: Redis): Promise<{ hits: number; misses: number; evicted: number; usedMemory: number; keys: number } | null> {
  try {
    const info = await redis.info();
    const field = (name: string) => Number(new RegExp(`^${name}:(\\d+)`, 'm').exec(info)?.[1] ?? NaN);
    return { hits: field('keyspace_hits'), misses: field('keyspace_misses'), evicted: field('evicted_keys'), usedMemory: field('used_memory'), keys: await redis.dbsize() };
  } catch {
    return null;
  }
}

/** Đọc counter của prom-client từ /metrics: { 'page_cache_lookups_total{variant="sau",...}': 12, ... }. */
export async function appCounters(): Promise<Record<string, number> | null> {
  try {
    const text = await (await fetch(`${BASE}/metrics`)).text();
    const out: Record<string, number> = {};
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const i = line.lastIndexOf(' ');
      out[line.slice(0, i)] = Number(line.slice(i + 1));
    }
    return out;
  } catch {
    return null;
  }
}

/** Cộng các counter có đủ mọi nhãn trong `match` (ví dụ { client: 'load', result: 'hit' }). */
export function sumCounter(counters: Record<string, number> | null, name: string, match: Record<string, string>): number {
  if (!counters) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(counters)) {
    if (!key.startsWith(`${name}{`)) continue;
    if (Object.entries(match).every(([k, v]) => key.includes(`${k}="${v}"`))) total += value;
  }
  return total;
}

/** Redis riêng cho script đo: không timeout ngắn. */
export function benchRedis(): Redis {
  const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:56379', { maxRetriesPerRequest: 1, commandTimeout: 5_000 });
  r.on('error', () => {});
  return r;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (rank - lo);
}
export const round = (x: number, digits = 1) => Number(x.toFixed(digits));
export const summarize = (xs: number[]) => ({ median: percentile(xs, 50), min: Math.min(...xs), max: Math.max(...xs) });
export function dist(xs: number[], digits = 0) {
  if (!xs.length) return { n: 0 };
  return { n: xs.length, p50: round(percentile(xs, 50), digits), p95: round(percentile(xs, 95), digits), p99: round(percentile(xs, 99), digits), max: round(Math.max(...xs), digits), min: round(Math.min(...xs), digits) };
}

/** Hàm băm 32 bit tất định (giống k6 script) để chọn sản phẩm cho kịch bản mà không dùng Math.random. */
export function hash32(a: number): number {
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d);
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b);
  a ^= a >>> 16;
  return a >>> 0;
}
