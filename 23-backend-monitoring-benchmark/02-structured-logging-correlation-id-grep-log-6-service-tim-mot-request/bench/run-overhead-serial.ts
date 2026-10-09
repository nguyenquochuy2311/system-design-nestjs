// Overhead theo từng request khi máy bận (nhật ký 01/03 điểm 5, mẫu 23/01): mô hình đóng 1 VU (request nối tiếp),
// POST /topups qua gateway, 4 cách log (truoc / sau / sau-async / off), 3 vòng xoay thứ tự. Bổ sung cho run-overhead.ts:
// ở 150 req/s và 32 VU, dao động giữa các vòng trên máy bận lớn hơn chênh lệch cần đo.
// Chạy: pnpm bench:overhead-serial [--rounds 3 --duration 20 --out main]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { appMode, k6 } from './lib/compose.js';
import { machineState, median, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: { rounds: { type: 'string', default: '3' }, duration: { type: 'string', default: '20' }, out: { type: 'string', default: 'main' } },
});
const DIR = `${args.out}/overhead-serial`;
mkdirSync(`bench/results/${DIR}`, { recursive: true });
type Mode = 'truoc' | 'sau' | 'sau-async' | 'off';
const ORDERS: Mode[][] = [
  ['truoc', 'sau', 'sau-async', 'off'],
  ['off', 'sau-async', 'truoc', 'sau'],
  ['sau', 'off', 'truoc', 'sau-async'],
];

const results: { round: number; mode: Mode; p50: number; p95: number; p99: number; rps: number; machine: unknown; sleepGaps: unknown[] }[] = [];
for (let r = 1; r <= Number(args.rounds); r++) {
  for (const mode of ORDERS[(r - 1) % 3]!) {
    const name = `r${r}-${mode}`;
    await appMode(mode === 'sau-async' ? 'sau' : mode, '', mode !== 'sau-async');
    await sleep(3000);
    const machine = await machineState();
    const gaps = startSleepDetector();
    await k6('logging-overhead.k6.js', { MODE: 'closed', VUS: '1', DURATION: '5s' }, `${DIR}/${name}-warmup.json`);
    const run = await k6('logging-overhead.k6.js', { MODE: 'closed', VUS: '1', DURATION: `${args.duration}s` }, `${DIR}/${name}.json`);
    if (run.code !== 0) throw new Error(`k6 ${name} → ${run.code}: ${run.stderr.slice(-500)}`);
    const m = (JSON.parse(readFileSync(`bench/results/${DIR}/${name}.json`, 'utf8')) as { metrics: Record<string, Record<string, number>> }).metrics;
    const row = { round: r, mode, p50: m.http_req_duration!['p(50)']!, p95: m.http_req_duration!['p(95)']!, p99: m.http_req_duration!['p(99)']!, rps: m.http_reqs!.rate!, machine, sleepGaps: gaps.stop() };
    results.push(row);
    console.log(JSON.stringify({ name, p50: row.p50.toFixed(3), p95: row.p95.toFixed(3), p99: row.p99.toFixed(3), rps: row.rps.toFixed(0) }));
  }
}
await appMode('sau');
const stat = (mode: Mode, k: 'p50' | 'p95' | 'p99' | 'rps') => {
  const xs = results.filter((x) => x.mode === mode).map((x) => x[k]);
  return { median: Number(median(xs).toFixed(3)), min: Number(Math.min(...xs).toFixed(3)), max: Number(Math.max(...xs).toFixed(3)) };
};
const byMode = (m: Mode) => ({ p50: stat(m, 'p50'), p95: stat(m, 'p95'), p99: stat(m, 'p99'), rps: stat(m, 'rps') });
const get = (r: number, m: Mode) => results.find((x) => x.round === r && x.mode === m)!;
const summary = {
  config: args,
  truoc: byMode('truoc'),
  sau: byMode('sau'),
  'sau-async': byMode('sau-async'),
  off: byMode('off'),
  perRound: Array.from({ length: Number(args.rounds) }, (_, i) => ({
    round: i + 1,
    sauMinusOffP50: Number((get(i + 1, 'sau').p50 - get(i + 1, 'off').p50).toFixed(3)),
    sauAsyncMinusOffP50: Number((get(i + 1, 'sau-async').p50 - get(i + 1, 'off').p50).toFixed(3)),
    truocMinusOffP50: Number((get(i + 1, 'truoc').p50 - get(i + 1, 'off').p50).toFixed(3)),
    sauMinusOffP99: Number((get(i + 1, 'sau').p99 - get(i + 1, 'off').p99).toFixed(3)),
  })),
  results,
};
writeFileSync(`bench/results/${DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ truoc: summary.truoc, sau: summary.sau, 'sau-async': summary['sau-async'], off: summary.off, perRound: summary.perRound }, null, 2));
