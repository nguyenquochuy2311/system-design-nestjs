/**
 * Chọn tham số Argon2id (m, t, p) bằng BENCHMARK trên chính máy này (RFC 9106 §4, OWASP: đo trên máy đích,
 * chọn chi phí cao nhất mà độ trễ còn chấp nhận được). Quét một tập ứng viên đều ở mức ≥ tối thiểu OWASP cho
 * web, đo trung vị thời gian một lần băm, rồi chọn cấu hình có trung vị gần TARGET_MS nhất trong dải cho phép
 * (ưu tiên bộ nhớ cao hơn khi hòa). Ghi điều kiện máy mỗi lượt.
 * Chạy: RUN=main pnpm bench:params   (TARGET_MS, N có thể chỉnh qua env)
 */
import { Algorithm, Version, hash } from '@node-rs/argon2';
import { machineState, median, startSleepDetector, writeResult } from './lib/env.js';

const N = Number(process.env.N ?? 15);
const TARGET_MS = Number(process.env.TARGET_MS ?? 120);
const LO = Number(process.env.TARGET_LO ?? 90);
const HI = Number(process.env.TARGET_HI ?? 280);
const pepper = Buffer.from('pepper-benchmark', 'utf8');

// Tất cả ứng viên p=1, memory-hard, ≥ tối thiểu OWASP cho web (m=19456,t=2 hoặc m=47104,t=1).
const candidates: { m: number; t: number; p: number }[] = [
  { m: 19456, t: 2, p: 1 },
  { m: 47104, t: 1, p: 1 },
  { m: 47104, t: 3, p: 1 },
  { m: 65536, t: 2, p: 1 },
  { m: 65536, t: 3, p: 1 },
  { m: 65536, t: 5, p: 1 },
  { m: 98304, t: 3, p: 1 },
  { m: 131072, t: 2, p: 1 },
  { m: 131072, t: 3, p: 1 },
];

async function timeOne(m: number, t: number, p: number): Promise<number[]> {
  const opts = { algorithm: Algorithm.Argon2id, version: Version.V0x13, memoryCost: m, timeCost: t, parallelism: p, secret: pepper };
  // Warm-up 2 lần để JIT/cấp phát ổn định.
  await hash('warmup', opts);
  await hash('warmup', opts);
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    await hash(`mk-${m}-${t}-${i}`, opts);
    times.push(performance.now() - s);
  }
  return times;
}

const sleep = startSleepDetector();
const before = machineState();
interface Measured { m: number; t: number; p: number; medianMs: number; minMs: number; maxMs: number; memMiB: number }
const results: Measured[] = [];
for (const c of candidates) {
  const times = await timeOne(c.m, c.t, c.p);
  const med = median(times);
  results.push({ ...c, medianMs: Number(med.toFixed(2)), minMs: Number(Math.min(...times).toFixed(2)), maxMs: Number(Math.max(...times).toFixed(2)), memMiB: c.m / 1024 });
  console.log(`m=${c.m}KiB (${(c.m / 1024).toFixed(0)} MiB) t=${c.t} p=${c.p}: trung vị ${med.toFixed(1)} ms (${Math.min(...times).toFixed(1)}–${Math.max(...times).toFixed(1)})`);
}
const after = machineState();
const sleepGaps = sleep.stop();

// Chọn: trong dải [LO,HI], lấy bộ có trung vị GẦN TARGET nhất (hòa thì bộ nhớ cao hơn); nếu không bộ nào
// trong dải, lấy gần TARGET nhất trong tất cả. Cân bằng chi phí với độ trễ thay vì chỉ tối đa bộ nhớ.
const byTarget = (a: (typeof results)[number], b: (typeof results)[number]) =>
  Math.abs(a.medianMs - TARGET_MS) - Math.abs(b.medianMs - TARGET_MS) || b.m - a.m;
const inBand = results.filter((r) => r.medianMs >= LO && r.medianMs <= HI);
const pick = (inBand.length ? inBand.sort(byTarget) : [...results].sort(byTarget))[0]!;

console.log(`\n→ Khuyến nghị: m=${pick.m}KiB (${pick.memMiB} MiB), t=${pick.t}, p=${pick.p} — trung vị ${pick.medianMs} ms (mục tiêu ~${TARGET_MS} ms).`);
console.log(`  Đặt trong .env: ARGON2_MEMORY_KIB=${pick.m} ARGON2_TIME_COST=${pick.t} ARGON2_PARALLELISM=${pick.p}`);
if (sleepGaps.length) console.log(`!! Có ${sleepGaps.length} khoảng máy ngủ — chạy lại lượt này.`);
console.log(`→ ${writeResult('hash-params.json', { target: { TARGET_MS, LO, HI }, n: N, node: process.version, before, after, sleepGaps, results, pick })}`);
