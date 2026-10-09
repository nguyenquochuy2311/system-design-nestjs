// Overhead của instrumentation trên gateway (GET /orders/:id đi gateway → checkout → DB): cùng code, bật/tắt bằng
// OTEL_SDK_DISABLED cho cả 3 service. Mỗi vòng: tạo lại container, warm-up 10 s, mô hình mở 300 request/s trong 30 s
// (p95/p99), rồi mô hình đóng 32 VU trong 20 s (thông lượng tối đa). 3 vòng, đảo thứ tự bật/tắt giữa các vòng
// (nhật ký 02/02 điểm 2). Lấy CPU/RAM của service và Collector bằng docker stats mỗi ~5 s trong lượt mở.
// Chạy: pnpm bench:overhead [--rounds 3 --out main]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { k6, servicesWithTelemetry } from './lib/compose.js';
import { dockerStats, machineState, median, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    out: { type: 'string', default: 'main' },
    rate: { type: 'string', default: '300' },
    duration: { type: 'string', default: '30' },
    closed: { type: 'string', default: '20' },
    vus: { type: 'string', default: '32' },
  },
});
const OUT = `bench/results/${args.out}/overhead`;
mkdirSync(OUT, { recursive: true });
const CONTAINERS = ['gateway', 'checkout', 'promotion', 'otel-collector', 'prometheus'];

interface K6Summary {
  metrics: Record<string, Record<string, number>>;
}
const readK6 = (file: string) => JSON.parse(readFileSync(`bench/results/${file}`, 'utf8')) as K6Summary;

async function sampleStats(stopAt: number) {
  const samples: Record<string, { cpu: number; memMiB: number }>[] = [];
  while (Date.now() < stopAt) {
    samples.push(await dockerStats());
    await sleep(3000);
  }
  const avg = Object.fromEntries(
    CONTAINERS.map((c) => {
      const xs = samples.map((s) => s[c]).filter((x): x is { cpu: number; memMiB: number } => !!x);
      return [c, { cpuPct: Number(median(xs.map((x) => x.cpu)).toFixed(1)), memMiB: Number(median(xs.map((x) => x.memMiB)).toFixed(1)), samples: xs.length }];
    }),
  );
  return avg;
}

async function variant(round: number, enabled: boolean) {
  const name = `r${round}-${enabled ? 'on' : 'off'}`;
  await servicesWithTelemetry(enabled);
  await sleep(5000);
  const machine = await machineState();
  const gaps = startSleepDetector();
  await k6('overhead.k6.js', { MODE: 'open', RATE: args.rate, DURATION: '10s' }, `${args.out}/overhead/${name}-warmup.json`);
  const statsDone = sampleStats(Date.now() + (Number(args.duration) - 3) * 1000);
  const open = await k6('overhead.k6.js', { MODE: 'open', RATE: args.rate, DURATION: `${args.duration}s` }, `${args.out}/overhead/${name}-open.json`);
  const stats = await statsDone;
  const closed = await k6('overhead.k6.js', { MODE: 'closed', VUS: args.vus, DURATION: `${args.closed}s` }, `${args.out}/overhead/${name}-closed.json`);
  const o = readK6(`${args.out}/overhead/${name}-open.json`).metrics;
  const c = readK6(`${args.out}/overhead/${name}-closed.json`).metrics;
  const result = {
    round,
    telemetry: enabled ? 'on' : 'off',
    machine,
    machineAfter: await machineState(),
    sleepGaps: gaps.stop(),
    k6Exit: [open.code, closed.code],
    open: {
      p50: o.http_req_duration?.['p(50)'],
      p95: o.http_req_duration?.['p(95)'],
      p99: o.http_req_duration?.['p(99)'],
      reqs: o.http_reqs?.count,
      failed: o.http_req_failed?.passes ?? o.http_req_failed?.value,
      dropped: o.dropped_iterations?.count ?? 0,
    },
    closed: { rps: c.http_reqs?.rate, p95: c.http_req_duration?.['p(95)'], failedRate: c.http_req_failed?.value },
    stats,
  };
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ name, open: result.open, closed: result.closed, cpu: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.cpuPct])) }));
  return result;
}

console.log(`overhead: ${args.rounds} vòng, ${args.rate} req/s × ${args.duration} s + ${args.vus} VU × ${args.closed} s`);
const results: Awaited<ReturnType<typeof variant>>[] = [];
for (let r = 1; r <= Number(args.rounds); r++) {
  const order = r % 2 === 1 ? [false, true] : [true, false];
  for (const enabled of order) results.push(await variant(r, enabled));
}
await servicesWithTelemetry(true);

const pick = (t: 'on' | 'off', f: (x: (typeof results)[number]) => number | undefined) =>
  results.filter((x) => x.telemetry === t).map(f).filter((x): x is number => typeof x === 'number');
const stat = (xs: number[]) => ({ median: Number(median(xs).toFixed(3)), min: Number(Math.min(...xs).toFixed(3)), max: Number(Math.max(...xs).toFixed(3)) });
const perRound = Array.from({ length: Number(args.rounds) }, (_, i) => {
  const on = results.find((x) => x.round === i + 1 && x.telemetry === 'on')!;
  const off = results.find((x) => x.round === i + 1 && x.telemetry === 'off')!;
  return {
    round: i + 1,
    dP95ms: Number(((on.open.p95 ?? 0) - (off.open.p95 ?? 0)).toFixed(3)),
    dP99ms: Number(((on.open.p99 ?? 0) - (off.open.p99 ?? 0)).toFixed(3)),
    dClosedRps: Number(((on.closed.rps ?? 0) - (off.closed.rps ?? 0)).toFixed(1)),
  };
});
const summary = {
  config: args,
  on: {
    p95: stat(pick('on', (x) => x.open.p95)),
    p99: stat(pick('on', (x) => x.open.p99)),
    closedRps: stat(pick('on', (x) => x.closed.rps)),
    dropped: pick('on', (x) => x.open.dropped),
    failed: pick('on', (x) => x.open.failed as number),
  },
  off: {
    p95: stat(pick('off', (x) => x.open.p95)),
    p99: stat(pick('off', (x) => x.open.p99)),
    closedRps: stat(pick('off', (x) => x.closed.rps)),
    dropped: pick('off', (x) => x.open.dropped),
    failed: pick('off', (x) => x.open.failed as number),
  },
  perRound,
  cpuMemMedian: Object.fromEntries(
    (['on', 'off'] as const).map((t) => [
      t,
      Object.fromEntries(CONTAINERS.map((c) => [c, { cpuPct: stat(pick(t, (x) => x.stats[c]?.cpuPct)), memMiB: stat(pick(t, (x) => x.stats[c]?.memMiB)) }])),
    ]),
  ),
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
