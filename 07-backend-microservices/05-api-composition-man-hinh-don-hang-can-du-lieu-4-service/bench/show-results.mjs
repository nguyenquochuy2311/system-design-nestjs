import { readFileSync, existsSync } from 'node:fs';
const run = process.argv[2];
for (const v of ['truoc', 'sau']) {
  const mf = `bench/results/${run}/${v}-meta.json`;
  if (!existsSync(mf)) continue;
  const x = JSON.parse(readFileSync(mf, 'utf8'));
  for (const s of ['normal', 'shipping-down']) {
    const f = `bench/results/${run}/${v}-${s}.json`;
    if (!existsSync(f)) continue;
    const m = JSON.parse(readFileSync(f, 'utf8')).metrics, d = m.page_duration, n = (y) => y.toFixed(1);
    console.log(`${v}/${s}: pages=${m.iterations.count} req/page=${(m.http_reqs.count / m.iterations.count).toFixed(2)} ok=${m.page_ok?.count ?? 0} partial=${m.page_partial?.count ?? 0} failed=${m.page_failed?.count ?? 0} dropped=${m.dropped_iterations?.count ?? 0} p50=${n(d.med)} p95=${n(d['p(95)'])} p99=${n(d['p(99)'])} max=${n(d.max)}`);
  }
  console.log(`  delay=${x.delay} sleep=${JSON.stringify(x.sleepGaps)} power=${x.powerStart.slice(-16)}>${x.powerEnd.slice(-16)} load=${x.loadEnd[0].toFixed(1)}`);
}
