// Overhead theo từng request khi máy bận (nhật ký 01/03 điểm 5): mô hình đóng 1 VU (mỗi request nối tiếp request
// trước), GET /orders/:id qua gateway → checkout → DB, bật/tắt OTEL_SDK_DISABLED cho cả 3 service, 3 vòng đảo thứ tự.
// Bổ sung cho bench/run-overhead.ts: ở 300 req/s, p95/p99 dao động giữa các vòng lớn hơn chênh lệch cần đo.
// Chạy: pnpm bench:overhead-serial [--rounds 3 --duration 20 --out main]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { k6, servicesWithTelemetry } from './lib/compose.js';
import { machineState, median, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: { rounds: { type: 'string', default: '3' }, duration: { type: 'string', default: '20' }, out: { type: 'string', default: 'main' } },
});
const DIR = `${args.out}/overhead-serial`;
mkdirSync(`bench/results/${DIR}`, { recursive: true });

const results: { round: number; telemetry: string; p50: number; p95: number; p99: number; rps: number; machine: unknown; sleepGaps: unknown[] }[] = [];
for (let r = 1; r <= Number(args.rounds); r++) {
  for (const enabled of r % 2 === 1 ? [false, true] : [true, false]) {
    const name = `r${r}-${enabled ? 'on' : 'off'}`;
    await servicesWithTelemetry(enabled);
    await sleep(5000);
    const machine = await machineState();
    const gaps = startSleepDetector();
    await k6('overhead.k6.js', { MODE: 'closed', VUS: '1', DURATION: '5s' }, `${DIR}/${name}-warmup.json`);
    const run = await k6('overhead.k6.js', { MODE: 'closed', VUS: '1', DURATION: `${args.duration}s` }, `${DIR}/${name}.json`);
    if (run.code !== 0) throw new Error(`k6 ${name} → ${run.code}: ${run.stderr.slice(-500)}`);
    const m = (JSON.parse(readFileSync(`bench/results/${DIR}/${name}.json`, 'utf8')) as { metrics: Record<string, Record<string, number>> }).metrics;
    const row = { round: r, telemetry: enabled ? 'on' : 'off', p50: m.http_req_duration!['p(50)']!, p95: m.http_req_duration!['p(95)']!, p99: m.http_req_duration!['p(99)']!, rps: m.http_reqs!.rate!, machine, sleepGaps: gaps.stop() };
    results.push(row);
    console.log(JSON.stringify({ name, p50: row.p50.toFixed(3), p95: row.p95.toFixed(3), p99: row.p99.toFixed(3), rps: row.rps.toFixed(0) }));
  }
}
await servicesWithTelemetry(true);
const stat = (t: string, k: 'p50' | 'p95' | 'p99' | 'rps') => {
  const xs = results.filter((x) => x.telemetry === t).map((x) => x[k]);
  return { median: Number(median(xs).toFixed(3)), min: Number(Math.min(...xs).toFixed(3)), max: Number(Math.max(...xs).toFixed(3)) };
};
const summary = {
  config: args,
  on: { p50: stat('on', 'p50'), p95: stat('on', 'p95'), p99: stat('on', 'p99'), rps: stat('on', 'rps') },
  off: { p50: stat('off', 'p50'), p95: stat('off', 'p95'), p99: stat('off', 'p99'), rps: stat('off', 'rps') },
  perRound: Array.from({ length: Number(args.rounds) }, (_, i) => {
    const on = results.find((x) => x.round === i + 1 && x.telemetry === 'on')!;
    const off = results.find((x) => x.round === i + 1 && x.telemetry === 'off')!;
    return { round: i + 1, dP50ms: Number((on.p50 - off.p50).toFixed(3)), dP95ms: Number((on.p95 - off.p95).toFixed(3)), dP99ms: Number((on.p99 - off.p99).toFixed(3)) };
  }),
  results,
};
writeFileSync(`bench/results/${DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ on: summary.on, off: summary.off, perRound: summary.perRound }, null, 2));
