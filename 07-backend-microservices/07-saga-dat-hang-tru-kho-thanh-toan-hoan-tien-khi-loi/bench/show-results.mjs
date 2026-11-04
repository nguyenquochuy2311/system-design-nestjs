import { readFileSync, existsSync } from 'node:fs';
const run = process.argv[2];
for (const v of ['truoc', 'sau']) {
  const f = `bench/results/${run}/${v}-meta.json`;
  if (!existsSync(f)) continue;
  const x = JSON.parse(readFileSync(f, 'utf8'));
  const m = JSON.parse(readFileSync(`bench/results/${run}/${v}-load.json`, 'utf8')).metrics, d = m.order_accepted_duration;
  console.log(`${v}: ${JSON.stringify(x.report)}`);
  console.log(`  k6 accepted=${m.iterations.count - (m.order_unavailable?.count ?? 0)} unavailable=${m.order_unavailable?.count ?? 0} dropped=${m.dropped_iterations?.count ?? 0} p50=${d.med.toFixed(1)} p95=${d['p(95)'].toFixed(1)} p99=${d['p(99)'].toFixed(1)} max=${d.max.toFixed(1)}`);
  console.log(`  settleMs=${x.settleMs} release=${JSON.stringify(x.release)} kills=${x.killedAt} sleep=${JSON.stringify(x.sleepGaps)} power=${x.powerStart.slice(-16)}>${x.powerEnd.slice(-16)} load=${x.loadEnd[0].toFixed(1)}`);
}
