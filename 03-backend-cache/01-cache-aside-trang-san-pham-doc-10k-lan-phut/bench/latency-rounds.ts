/**
 * So độ trễ trước/sau ở trạng thái ổn định (nhật ký quyết định bài 02/02): ROUNDS vòng, mỗi vòng một lượt mỗi bản,
 * thứ tự đảo giữa các vòng; mỗi lượt khởi động nóng WARMUP_S giây trên chính bản đó, bản sau xóa cache TRƯỚC khởi động
 * nóng (FLUSH=before) nên lúc đo 500 id nóng đã nằm trong cache, phần đuôi 20 % vẫn trượt như thật.
 *   RUN=main ROUNDS=5 MEASURE_S=60 WARMUP_S=20 pnpm bench:rounds   → bench/results/<RUN>/rounds/, <RUN>/latency-rounds.json
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { round, summarize } from './lib';

const RUN = process.env.RUN ?? 'main';
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const MEASURE_S = process.env.MEASURE_S ?? '60';
const WARMUP_S = process.env.WARMUP_S ?? '20';
const OUT = join('bench/results', RUN, 'rounds');
const variants = ['truoc', 'sau'];

interface LoadResult {
  requests: number;
  non200: number;
  droppedIterations: number;
  latencyMs: { p50: number; p95: number; p99: number };
  latencyBySourceMs: Record<string, { p95: number } | undefined>;
  db: { callsPerRequestPct: number };
  cache: { appHitRatioPct: number | null };
  cpuPct: { postgres: { pct: number } | null };
}
const runs: (LoadResult & { variant: string; round: number })[] = [];
for (let r = 1; r <= ROUNDS; r++) {
  const order = r % 2 === 1 ? variants : [...variants].reverse();
  for (const variant of order) {
    const name = `r${r}-${variant}`;
    const env = { ...process.env, RUN: join(RUN, 'rounds'), NAME: name, VARIANT: variant, DURATION_S: MEASURE_S, WARMUP_S, FLUSH: variant === 'sau' ? 'before' : 'none' };
    const res = spawnSync(process.execPath, ['--import', 'tsx', 'bench/run-load.ts'], { env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`${name} lỗi: ${res.stderr}`);
    const result = JSON.parse(readFileSync(join(OUT, `${name}.json`), 'utf8')) as LoadResult;
    runs.push({ ...result, variant, round: r });
    console.log(`${name}: p50 ${result.latencyMs.p50} · p95 ${result.latencyMs.p95} · p99 ${result.latencyMs.p99} ms · DB ${result.db.callsPerRequestPct} % · dropped ${result.droppedIterations} · non200 ${result.non200}`);
  }
}
const pick = (v: string, f: (x: LoadResult) => number) => summarize(runs.filter((x) => x.variant === v).map(f));
const summary = Object.fromEntries(
  variants.map((v) => [
    v,
    {
      p50: pick(v, (x) => x.latencyMs.p50),
      p95: pick(v, (x) => x.latencyMs.p95),
      p99: pick(v, (x) => x.latencyMs.p99),
      hitP95: v === 'sau' ? pick(v, (x) => x.latencyBySourceMs.hit?.p95 ?? NaN) : null,
      missP95: v === 'sau' ? pick(v, (x) => x.latencyBySourceMs.miss?.p95 ?? NaN) : null,
      dbCallsPerRequestPct: pick(v, (x) => x.db.callsPerRequestPct),
      postgresCpuPct: pick(v, (x) => x.cpuPct.postgres?.pct ?? NaN),
      hitRatioPct: v === 'sau' ? pick(v, (x) => x.cache.appHitRatioPct ?? NaN) : null,
      non200: runs.filter((x) => x.variant === v).reduce((a, x) => a + x.non200, 0),
      dropped: runs.filter((x) => x.variant === v).reduce((a, x) => a + x.droppedIterations, 0),
    },
  ]),
);
// Chênh lệch (sau − trước) trong từng vòng: so với dao động giữa các vòng của cùng một bản trước khi kết luận.
const diffs = Array.from({ length: ROUNDS }, (_, i) => {
  const t = runs.find((x) => x.round === i + 1 && x.variant === 'truoc')!;
  const s = runs.find((x) => x.round === i + 1 && x.variant === 'sau')!;
  return { round: i + 1, p50: round(s.latencyMs.p50 - t.latencyMs.p50, 2), p95: round(s.latencyMs.p95 - t.latencyMs.p95, 2), p99: round(s.latencyMs.p99 - t.latencyMs.p99, 2) };
});
writeFileSync(join('bench/results', RUN, 'latency-rounds.json'), JSON.stringify({ env: { ROUNDS, MEASURE_S, WARMUP_S }, summary, diffs, runs: runs.map(({ variant, round: r, latencyMs, db, cache, droppedIterations, non200 }) => ({ variant, round: r, latencyMs, db, cache, droppedIterations, non200 })) }, null, 2));
console.log(JSON.stringify({ summary, diffs }, null, 1));
