// Độ trễ ingest: từ lúc service GHI dòng log (trường `timestamp` trong dòng) tới lúc dòng đó TRUY VẤN ĐƯỢC trong Loki
// (stdout → file json-file → Collector filelog poll 200 ms → batch 200 ms → OTLP → Loki). Ảnh hưởng tới điều tra sự cố:
// người trực chạy truy vấn ngay sau khi khách báo thì dòng mới nhất đã có chưa.
// Mỗi mẫu: một lần nạp (ngân hàng OK), hỏi Loki mỗi 50 ms tới khi thấy dòng `ledger.entry_confirmed` (dòng CUỐI của hành
// trình, ghi sau hàng đợi) — độ trễ = lúc thấy − timestamp của dòng. Ghi kèm observed_timestamp (lúc Collector đọc).
// Chạy: pnpm bench:ingest [--samples 30 --out main]
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BANK_OK, byTopupQuery, fakePhone, lokiRange, parse, sendTopup } from '../test/support/stack.js';
import { appMode } from './lib/compose.js';
import { machineState, median, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({ options: { samples: { type: 'string', default: '30' }, out: { type: 'string', default: 'main' } } });
const OUT = `bench/results/${args.out}`;
mkdirSync(OUT, { recursive: true });

await appMode('sau');
const machine = await machineState();
const gaps = startSleepDetector();
const samples: { topup_id: string; visibleAfterMs: number; collectorReadAfterMs: number; polls: number }[] = [];
for (let i = 0; i < Number(args.samples); i++) {
  const start = Date.now() - 2000;
  const { topup_id } = await sendTopup({ phone: fakePhone(80 + (i % 10)), amount: 300_000, bank: BANK_OK });
  let polls = 0;
  let found: { l: Awaited<ReturnType<typeof lokiRange>>[number]; at: number } | undefined;
  const deadline = Date.now() + 20_000;
  while (!found && Date.now() < deadline) {
    polls++;
    const lines = await lokiRange(byTopupQuery(topup_id), start);
    const l = lines.find((x) => /"event":"ledger\.entry_confirmed"/.test(x.line));
    if (l) found = { l, at: Date.now() };
    else await sleep(50); // hỏi lại sau 50 ms (độ phân giải của phép đo = 50 ms + thời gian một truy vấn)
  }
  if (!found) continue;
  const written = Date.parse(String(parse(found.l.line)?.timestamp));
  const observed = Number(BigInt(found.l.meta.observed_timestamp ?? '0') / 1_000_000n);
  samples.push({ topup_id, visibleAfterMs: found.at - written, collectorReadAfterMs: observed - written, polls });
  await sleep(300);
}
const vis = samples.map((s) => s.visibleAfterMs).sort((a, b) => a - b);
const rd = samples.map((s) => s.collectorReadAfterMs).sort((a, b) => a - b);
const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)]!;
const summary = {
  machine,
  machineAfter: await machineState(),
  sleepGaps: gaps.stop(),
  samples: samples.length,
  pollIntervalMs: 50,
  visibleAfterMs: { p50: median(vis), p95: p(vis, 0.95), max: vis[vis.length - 1], min: vis[0] },
  collectorReadAfterMs: { p50: median(rd), p95: p(rd, 0.95), max: rd[rd.length - 1], min: rd[0] },
};
writeFileSync(`${OUT}/ingest-latency.json`, JSON.stringify({ summary, samples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
