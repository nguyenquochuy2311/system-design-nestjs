// Phần dùng chung của các script đo: bật/tắt API như một tiến trình riêng, đọc số liệu từ PostgreSQL, Redis, cgroup.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/shared/db';

const execFileAsync = promisify(execFile);
export const BASE = 'http://127.0.0.1:3100';

export interface Api {
  child: ChildProcess;
  pid: number;
  stop: () => Promise<void>;
}

/** API là tiến trình node riêng (không chung tiến trình với script đo), giống `pnpm dev`. */
export async function startApi(logFile: string, env: Record<string, string> = {}): Promise<Api> {
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env: { ...process.env, PORT: '3100', ...env }, stdio: ['ignore', log, log] });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await exited;
  };
  process.on('exit', () => child.kill('SIGKILL'));
  await waitHttp(`${BASE}/health`);
  return { child, pid: child.pid!, stop };
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

export const run = async (cmd: string, args: string[]) => (await execFileAsync(cmd, args, { encoding: 'utf8' })).stdout;

/** usage_usec trong cgroup v2 của container (cùng nguồn docker stats dùng). null nếu container đang dừng. */
export async function containerCpuUsec(service: 'postgres' | 'redis'): Promise<number | null> {
  try {
    const out = await run('docker', ['compose', 'exec', '-T', service, 'cat', '/sys/fs/cgroup/cpu.stat']);
    return Number(/usage_usec (\d+)/.exec(out)?.[1]);
  } catch {
    return null;
  }
}

/** /proc/stat và /proc/loadavg của máy ảo Docker (container dùng chung kernel), nhật ký quyết định bài 02/03. */
export async function dockerVm(): Promise<{ idle: number; total: number; load1: number }> {
  const out = await run('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'head -1 /proc/stat; cat /proc/loadavg']);
  const [statLine = '', loadLine = ''] = out.trim().split('\n');
  const n = statLine.trim().split(/\s+/).slice(1).map(Number);
  return { idle: (n[3] ?? 0) + (n[4] ?? 0), total: n.reduce((a, b) => a + b, 0), load1: Number(loadLine.split(' ')[0]) };
}

/** Thời gian CPU đã dùng (giây) của một tiến trình trên host, đọc bằng ps (dạng [phút:]giây.phần trăm). */
export async function processCpuSeconds(pid: number): Promise<number | null> {
  try {
    const out = (await run('ps', ['-o', 'time=', '-p', String(pid)])).trim();
    const parts = out.split(':').map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  } catch {
    return null;
  }
}

/** Số lần gọi và tổng thời gian thực thi của câu trang sản phẩm (câu duy nhất chạm product_images). */
export async function productQueryStats(db: Kysely<Database>): Promise<{ calls: number; totalExecMs: number; queries: number }> {
  const { rows } = await sql<{ calls: number; total_ms: number; n: number }>`
    SELECT coalesce(sum(calls), 0)::bigint AS calls, coalesce(sum(total_exec_time), 0)::float8 AS total_ms, count(*)::int AS n
    FROM pg_stat_statements WHERE query ILIKE '%product_images%' AND query NOT ILIKE '%pg_stat_statements%'`.execute(db);
  return { calls: Number(rows[0]?.calls ?? 0), totalExecMs: Number(rows[0]?.total_ms ?? 0), queries: Number(rows[0]?.n ?? 0) };
}

export async function redisInfo(redis: Redis): Promise<{ hits: number; misses: number; usedMemory: number; keys: number } | null> {
  try {
    const info = await redis.info();
    const field = (name: string) => Number(new RegExp(`^${name}:(\\d+)`, 'm').exec(info)?.[1] ?? NaN);
    return { hits: field('keyspace_hits'), misses: field('keyspace_misses'), usedMemory: field('used_memory'), keys: await redis.dbsize() };
  } catch {
    return null;
  }
}

/** Đọc counter của prom-client từ /metrics: { 'product_cache_lookups_total{result="hit"}': 12, ... }. */
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

/** Redis riêng cho script đo: không timeout ngắn, không ồn khi Redis bị dừng có chủ đích. */
export function benchRedis(): Redis {
  const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:56379', { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 1_000, retryStrategy: () => 500 });
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
export const median = (xs: number[]) => percentile(xs, 50);
export const round = (x: number, digits = 1) => Number(x.toFixed(digits));
export const summarize = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
