/**
 * Đo overhead p95 của interceptor (README mục 5, dòng 4): cùng app, cùng handler; `/truoc/payments` không có,
 * `/sau/payments` có interceptor idempotency. 3 vòng, xoay thứ tự (truoc→sau, sau→truoc, truoc→sau), mỗi bước
 * 10 s làm nóng + 30 s đo ở tải cố định. Kèm thời gian một vòng gọi DB (`SELECT 1`) để đọc độ chênh (nhật ký 02/04 điểm 4).
 * Chạy: RUN=main pnpm bench:overhead   (RATE=200 WARMUP=10s DURATION=30s PLAN="truoc,sau|sau,truoc|truoc,sau";
 *       VUS=1 để chạy mô hình đóng, một request nối tiếp một request)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { createDb } from '../src/shared/db.js';
import { k6, postgresCpuSeconds, startApi, versions } from './lib/api-process.js';
import { machineState, median, RESULTS_DIR, RUN, startSleepDetector, writeResult } from './lib/env.js';

const RATE = process.env.RATE ?? '200';
const WARMUP = process.env.WARMUP ?? '10s';
const DURATION = process.env.DURATION ?? '30s';
const PLAN = (process.env.PLAN ?? 'truoc,sau|sau,truoc|truoc,sau').split('|').map((r) => r.split(','));
const TAG = `${RUN}-overhead-${Date.now()}`;

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;

/** Thời gian một vòng `SELECT 1` từ host qua cổng 55432: tuần tự và 10 luồng song song (bằng pool của API). */
async function dbRoundTrip() {
  const db = createDb({ max: 10 });
  const one = async () => {
    const t = performance.now();
    await sql`SELECT 1`.execute(db);
    return performance.now() - t;
  };
  for (let i = 0; i < 200; i++) await one();
  const sequential: number[] = [];
  for (let i = 0; i < 2000; i++) sequential.push(await one());
  const parallel: number[] = [];
  await Promise.all(Array.from({ length: 10 }, async () => { for (let i = 0; i < 200; i++) parallel.push(await one()); }));
  await db.destroy();
  const s = (xs: number[]) => ({ med: median(xs), p95: pct(xs, 95), p99: pct(xs, 99) });
  return { sequential: s(sequential), parallel10: s(parallel) };
}

const sleep = startSleepDetector();
const env = { versions: await versions(), before: machineState(), selectOne: await dbRoundTrip() };
console.log(`SELECT 1: ${JSON.stringify(env.selectOne)}`);
const api = await startApi(3100);
const steps: unknown[] = [];
try {
  for (const [r, round] of PLAN.entries()) {
    for (const variant of round) {
      const name = `r${r + 1}-${variant}`;
      const out = resolve(RESULTS_DIR, 'overhead', `${name}.json`);
      writeResult(`overhead/${name}.json`, {});
      const before = machineState();
      const pg0 = await postgresCpuSeconds();
      const api0 = api.cpuSeconds();
      const t0 = Date.now();
      const res = await k6(['run', '--quiet', '-e', `VARIANT=${variant}`,  '-e', `RATE=${RATE}`, ...(process.env.VUS ? ['-e', `VUS=${process.env.VUS}`] : []), '-e', `WARMUP=${WARMUP}`, '-e', `DURATION=${DURATION}`, '-e', `PREFIX=${TAG}-${name}`, '-e', `OUT=${out}`, 'bench/payment-latency.k6.js']);
      const wallSeconds = (Date.now() - t0) / 1000;
      if (res.status !== 0) throw new Error(`k6 ${name} thoát mã ${res.status}`);
      const summary = JSON.parse(readFileSync(out, 'utf8')) as { okRate: number; droppedIterations: number; ms: Record<string, number> };
      if (summary.okRate !== 1 || summary.droppedIterations > 0) console.log(`!! ${name}: okRate ${summary.okRate}, dropped ${summary.droppedIterations} — không dùng số của bước này`);
      const step = {
        round: r + 1, variant, name, wallSeconds, summary,
        postgresCpuPercent: (((await postgresCpuSeconds()) - pg0) / wallSeconds) * 100,
        apiCpuPercent: ((api.cpuSeconds() - api0) / wallSeconds) * 100,
        before, after: machineState(),
      };
      console.log(JSON.stringify({ name, ms: summary.ms, okRate: summary.okRate, dropped: summary.droppedIterations, load: step.after.load1, power: step.after.power }));
      steps.push(step);
    }
  }
} finally {
  await api.stop();
}
const gaps = sleep.stop();
const file = writeResult('overhead.json', { rate: Number(RATE), vus: process.env.VUS ? Number(process.env.VUS) : null, warmup: WARMUP, duration: DURATION, plan: PLAN, tag: TAG, ...env, after: machineState(), sleepGaps: gaps, steps });
console.log(`→ ${file}${gaps.length ? ` · CẢNH BÁO: máy ngủ ${gaps.length} lần, chạy lại lượt này` : ''}`);
