/**
 * Đo độ trễ /login p95: 3 vòng × (truoc, sau) XOAY THỨ TỰ giữa các vòng, ghi CPU của API và điều kiện máy.
 * Thêm thí nghiệm UV_THREADPOOL_SIZE (2/4/8) cho bản sau để thấy ảnh hưởng tới thông lượng (Argon2 tốn CPU,
 * chạy trên threadpool của libuv). Mỗi lượt kiểm tỉ lệ check đạt = 100% trước khi dùng p95 (nhật ký 01/02 điểm 1).
 * Chạy: RUN=main pnpm bench:login   (cần db:up; PASSWORD_PEPPER, ARGON2_* như môi trường thật)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb } from '../src/shared/db';
import { md5Hex } from '../src/shared/md5';
import { PasswordHasher } from '../src/sau/password-hasher';
import { hasherOptionsFromEnv } from '../src/sau/password-hasher.options';
import { k6, startApi } from './lib/api-process.js';
import { machineState, median, RESULTS_DIR, startSleepDetector, writeResult } from './lib/env.js';

const PORT = Number(process.env.PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const NUSERS = Number(process.env.NUSERS ?? 200);
const PASSWORD = process.env.BENCH_PASSWORD ?? 'bench-user-password-2026';
const VUS = process.env.VUS ?? '50';
const DURATION = process.env.DURATION ?? '30s';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const opts = hasherOptionsFromEnv();

async function mapLimit<T>(items: T[], c: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: c }, async () => { while (next < items.length) await fn(items[next++]!); }));
}

/** Tạo NUSERS tài khoản "bench" ở version 2 (Argon2id tham số hiện hành) + password_md5 cho bản truoc. */
async function seedBenchUsers() {
  const hasher = new PasswordHasher(opts);
  const db = createDb({ max: 10 });
  try {
    await db.deleteFrom('users').where('email', 'like', '%@lab.bench').execute();
    const ids = Array.from({ length: NUSERS }, (_, i) => i);
    const rows: { email: string; password_md5: string; password_hash: string }[] = [];
    await mapLimit(ids, Number(process.env.UV_THREADPOOL_SIZE ?? 4), async (i) => {
      rows.push({ email: `bench${i}@lab.bench`, password_md5: md5Hex(PASSWORD), password_hash: await hasher.hash(PASSWORD) });
    });
    for (let i = 0; i < rows.length; i += 500)
      await db.insertInto('users').values(rows.slice(i, i + 500).map((r) => ({ ...r, hash_version: 2 }))).execute();
    console.log(`Đã tạo ${rows.length} tài khoản bench (version 2, m=${opts.memoryCost}KiB t=${opts.timeCost} p=${opts.parallelism}).`);
  } finally {
    await db.destroy();
  }
}

interface K6Summary {
  metrics: {
    http_req_duration: { values: Record<string, number> };
    http_req_failed?: { values: { rate: number } };
    checks?: { values: { rate: number } };
    iterations: { values: { count: number; rate: number } };
  };
}

async function runK6(variant: 'truoc' | 'sau', out: string, duration = DURATION, vus = VUS, env: Record<string, string> = {}) {
  const abs = resolve(RESULTS_DIR, out);
  const r = await k6([
    'run', '-e', `BASE=${BASE}`, '-e', `VARIANT=${variant}`, '-e', `VUS=${vus}`, '-e', `DURATION=${duration}`,
    '-e', `NUSERS=${NUSERS}`, '-e', `PASSWORD=${PASSWORD}`, '-e', `OUT=${abs}`, 'bench/login.k6.js',
  ]);
  if (r.status !== 0) throw new Error(`k6 lỗi (${variant})`);
  const s = JSON.parse(readFileSync(abs, 'utf8')) as K6Summary;
  const checksRate = s.metrics.checks?.values.rate ?? 0;
  const failedRate = s.metrics.http_req_failed?.values.rate ?? 0;
  // Không dùng số độ trễ nếu request không đạt 100% (nhật ký 01/02 điểm 1): báo lỗi để chạy lại.
  if (checksRate < 1 || failedRate > 0) throw new Error(`lượt ${variant}: check ${(checksRate * 100).toFixed(1)}%, lỗi ${(failedRate * 100).toFixed(1)}% — không dùng số này`);
  return {
    variant,
    p50: Number(s.metrics.http_req_duration.values['med']?.toFixed(1)),
    p95: Number(s.metrics.http_req_duration.values['p(95)']?.toFixed(1)),
    p99: Number(s.metrics.http_req_duration.values['p(99)']?.toFixed(1)),
    reqPerSec: Number(s.metrics.iterations.values.rate.toFixed(1)),
    iterations: s.metrics.iterations.values.count,
    checksRate: s.metrics.checks?.values.rate ?? null,
    failedRate: s.metrics.http_req_failed?.values.rate ?? null,
    ...env,
  };
}

const sleep = startSleepDetector();
const rounds: Record<string, unknown>[] = [];
await seedBenchUsers();
const api = await startApi(PORT, {
  UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? '4',
  ARGON2_MEMORY_KIB: String(opts.memoryCost),
  ARGON2_TIME_COST: String(opts.timeCost),
  ARGON2_PARALLELISM: String(opts.parallelism),
});
try {
  // ── Vòng chính: xoay thứ tự truoc/sau ──
  for (let r = 0; r < ROUNDS; r++) {
    const order: ('truoc' | 'sau')[] = r % 2 === 0 ? ['truoc', 'sau'] : ['sau', 'truoc'];
    const round: Record<string, unknown> = { round: r + 1, order: order.join('→'), machine: machineState() };
    for (const v of order) {
      const cpu0 = api.cpuSeconds();
      const res = await runK6(v, `round-${r + 1}-${v}.json`);
      round[v] = { ...res, apiCpuSeconds: Number((api.cpuSeconds() - cpu0).toFixed(1)) };
      console.log(`  vòng ${r + 1} ${v}: p95 ${res.p95} ms, p50 ${res.p50} ms, ${res.reqPerSec} req/s, check ${(Number(res.checksRate) * 100).toFixed(1)}%`);
    }
    rounds.push(round);
  }
} finally {
  await api.stop();
}

// ── Thí nghiệm UV_THREADPOOL_SIZE cho bản sau (khởi động lại API mỗi mức) ──
const uvSweep = [];
if (process.env.UV_SWEEP !== '0') {
  for (const uv of (process.env.UV_SIZES ?? '2,4,8').split(',')) {
    const a = await startApi(PORT, {
      UV_THREADPOOL_SIZE: uv,
      ARGON2_MEMORY_KIB: String(opts.memoryCost),
      ARGON2_TIME_COST: String(opts.timeCost),
      ARGON2_PARALLELISM: String(opts.parallelism),
    });
    try {
      const res = await runK6('sau', `uv-${uv}.json`, '20s');
      uvSweep.push({ uvThreadpoolSize: Number(uv), p95: res.p95, reqPerSec: res.reqPerSec, iterations: res.iterations });
      console.log(`  UV_THREADPOOL_SIZE=${uv}: ${res.reqPerSec} req/s, p95 ${res.p95} ms`);
    } finally {
      await a.stop();
    }
  }
}

const sleepGaps = sleep.stop();
const summarize = (v: 'truoc' | 'sau') => {
  const ps = [];
  for (const r of JSON.parse(JSON.stringify(rounds)) as Record<string, { p95: number }>[]) if (r[v]) ps.push(r[v]!.p95);
  return { p95Median: median(ps), p95ByRound: ps };
};
console.log(`\nTóm tắt: truoc p95 (trung vị ${summarize('truoc').p95Median} ms) ${summarize('truoc').p95ByRound.join('/')} · sau p95 (trung vị ${summarize('sau').p95Median} ms) ${summarize('sau').p95ByRound.join('/')}`);
if (sleepGaps.length) console.log(`!! ${sleepGaps.length} khoảng máy ngủ — chạy lại.`);
console.log(`→ ${writeResult('login.json', { node: process.version, params: opts, uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? '4', vus: VUS, duration: DURATION, nusers: NUSERS, rounds, uvSweep, summary: { truoc: summarize('truoc'), sau: summarize('sau') }, sleepGaps })}`);
