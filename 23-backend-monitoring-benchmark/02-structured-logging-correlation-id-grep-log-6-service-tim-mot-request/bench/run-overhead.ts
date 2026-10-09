// Overhead của logging trên gateway (POST /topups): cùng code, đổi LOG_MODE cho cả 4 service —
//   truoc = console.log chuỗi tự do (không trace context) · sau = pino JSON + redact + trace_id, ghi đồng bộ (mặc định của
//   pino) · sau-async = như sau, LOG_SYNC=false · off = như sau, không ghi log.
// Mỗi vòng: tạo lại container, warm-up 10 s, mô hình mở RATE req/s × DURATION (p95/p99), rồi mô hình đóng VUS × CLOSED
// (thông lượng tối đa). 3 vòng, xoay thứ tự giữa các vòng (nhật ký 02/02 điểm 2). CPU/RAM của service, Collector, Loki lấy
// bằng docker stats trong lượt mở. Chạy: pnpm bench:overhead [--rounds 3 --out main]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { appMode, k6 } from './lib/compose.js';
import { dockerStats, machineState, median, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    out: { type: 'string', default: 'main' },
    rate: { type: 'string', default: '150' },
    duration: { type: 'string', default: '30' },
    closed: { type: 'string', default: '20' },
    vus: { type: 'string', default: '32' },
  },
});
const OUT = `bench/results/${args.out}/overhead`;
mkdirSync(OUT, { recursive: true });
const CONTAINERS = ['gateway', 'topup', 'bank-adapter', 'ledger', 'otel-collector', 'loki', 'redis'];
type Mode = 'truoc' | 'sau' | 'sau-async' | 'off';

const readK6 = (file: string) => JSON.parse(readFileSync(`bench/results/${file}`, 'utf8')) as { metrics: Record<string, Record<string, number>> };

async function sampleStats(stopAt: number) {
  const samples: Record<string, { cpu: number; memMiB: number }>[] = [];
  while (Date.now() < stopAt) {
    samples.push(await dockerStats());
    await sleep(3000);
  }
  return Object.fromEntries(
    CONTAINERS.map((c) => {
      const xs = samples.map((s) => s[c]).filter((x): x is { cpu: number; memMiB: number } => !!x);
      return [c, { cpuPct: Number(median(xs.map((x) => x.cpu)).toFixed(1)), memMiB: Number(median(xs.map((x) => x.memMiB)).toFixed(1)), samples: xs.length }];
    }),
  ) as Record<string, { cpuPct: number; memMiB: number; samples: number }>;
}

async function variant(round: number, mode: Mode) {
  const name = `r${round}-${mode}`;
  await appMode(mode === 'sau-async' ? 'sau' : mode, '', mode !== 'sau-async');
  await sleep(3000);
  const machine = await machineState();
  const gaps = startSleepDetector();
  await k6('logging-overhead.k6.js', { MODE: 'open', RATE: args.rate, DURATION: '10s' }, `${args.out}/overhead/${name}-warmup.json`);
  const statsDone = sampleStats(Date.now() + (Number(args.duration) - 3) * 1000);
  const open = await k6('logging-overhead.k6.js', { MODE: 'open', RATE: args.rate, DURATION: `${args.duration}s` }, `${args.out}/overhead/${name}-open.json`);
  const stats = await statsDone;
  const closed = await k6('logging-overhead.k6.js', { MODE: 'closed', VUS: args.vus, DURATION: `${args.closed}s` }, `${args.out}/overhead/${name}-closed.json`);
  const o = readK6(`${args.out}/overhead/${name}-open.json`).metrics;
  const c = readK6(`${args.out}/overhead/${name}-closed.json`).metrics;
  const result = {
    round,
    mode,
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

const ORDERS: Mode[][] = [
  ['truoc', 'sau', 'sau-async', 'off'],
  ['off', 'sau-async', 'truoc', 'sau'],
  ['sau', 'off', 'truoc', 'sau-async'],
];
console.log(`overhead: ${args.rounds} vòng, ${args.rate} req/s × ${args.duration} s + ${args.vus} VU × ${args.closed} s`);
const results: Awaited<ReturnType<typeof variant>>[] = [];
for (let r = 1; r <= Number(args.rounds); r++) for (const m of ORDERS[(r - 1) % 3]!) results.push(await variant(r, m));
await appMode('sau');

const pick = (m: Mode, f: (x: (typeof results)[number]) => number | undefined) =>
  results.filter((x) => x.mode === m).map(f).filter((x): x is number => typeof x === 'number');
const stat = (xs: number[]) => (xs.length ? { median: Number(median(xs).toFixed(3)), min: Number(Math.min(...xs).toFixed(3)), max: Number(Math.max(...xs).toFixed(3)) } : null);
const perRound = Array.from({ length: Number(args.rounds) }, (_, i) => {
  const get = (m: Mode) => results.find((x) => x.round === i + 1 && x.mode === m)!;
  const d = (a: Mode, b: Mode) => ({
    dP95ms: Number(((get(a).open.p95 ?? 0) - (get(b).open.p95 ?? 0)).toFixed(3)),
    dP99ms: Number(((get(a).open.p99 ?? 0) - (get(b).open.p99 ?? 0)).toFixed(3)),
    dClosedRps: Number(((get(a).closed.rps ?? 0) - (get(b).closed.rps ?? 0)).toFixed(1)),
  });
  return {
    round: i + 1,
    sauMinusOff: d('sau', 'off'),
    sauMinusTruoc: d('sau', 'truoc'),
    sauAsyncMinusOff: d('sau-async', 'off'),
    sauAsyncMinusTruoc: d('sau-async', 'truoc'),
    truocMinusOff: d('truoc', 'off'),
  };
});
const byMode = (m: Mode) => ({
  p50: stat(pick(m, (x) => x.open.p50)),
  p95: stat(pick(m, (x) => x.open.p95)),
  p99: stat(pick(m, (x) => x.open.p99)),
  closedRps: stat(pick(m, (x) => x.closed.rps)),
  dropped: pick(m, (x) => x.open.dropped),
  failed: pick(m, (x) => x.open.failed as number),
  cpuPct: Object.fromEntries(CONTAINERS.map((c) => [c, stat(pick(m, (x) => x.stats[c]?.cpuPct))])),
});
const summary = { config: args, truoc: byMode('truoc'), sau: byMode('sau'), 'sau-async': byMode('sau-async'), off: byMode('off'), perRound };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
