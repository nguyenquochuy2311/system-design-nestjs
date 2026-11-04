import { readFileSync, existsSync } from 'node:fs';
const run = process.argv[2];
const n = (y) => (y ?? 0).toFixed(1);
for (const v of ['truoc', 'sau']) {
  const mf = `bench/results/${run}/${v}-meta.json`;
  if (!existsSync(mf)) continue;
  const x = JSON.parse(readFileSync(mf, 'utf8'));
  for (const s of ['sustained', 'batch']) {
    const m = JSON.parse(readFileSync(`bench/results/${run}/${v}-${s}.json`, 'utf8')).metrics, d = m.notes_duration, w = m.notes_wait_ms;
    console.log(`${v}/${s}: notes ok=${m.notes_ok?.count ?? 0} failed=${m.notes_failed?.count ?? 0} p50=${n(d.med)} p95=${n(d['p(95)'])} p99=${n(d['p(99)'])} max=${n(d.max)} | wait p99=${w ? n(w['p(99)']) : '-'} max=${w ? n(w.max) : '-'} | reports done=${m.reports_done?.count ?? 0} rejected=${m.reports_rejected?.count ?? 0} failed=${m.reports_failed?.count ?? 0} p95=${n(m.report_duration?.['p(95)'])} | export p95=${n(m.export_duration?.['p(95)'])} dropped=${m.dropped_iterations?.count ?? 0}`);
  }
  console.log(`  peak=${x.peakConnections} batchMs=${x.batchMs} exports=${JSON.stringify(x.exports)} sleep=${JSON.stringify(x.sleepGaps)} power=${x.powerStart.slice(-16)}>${x.powerEnd.slice(-16)} load=${x.loadEnd[0].toFixed(1)}`);
}
