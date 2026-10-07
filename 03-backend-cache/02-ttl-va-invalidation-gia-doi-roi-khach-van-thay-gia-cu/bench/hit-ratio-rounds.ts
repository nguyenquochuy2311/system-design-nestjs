/**
 * So hit ratio và tải DB của hai bản khi có đổi giá (nhật ký quyết định bài 02/02: nhiều vòng, đảo thứ tự): ROUNDS vòng,
 * mỗi vòng một lượt mỗi bản, cùng chuỗi request k6 tất định và cùng CHANGES lần đổi giá (mỗi CHANGE_EVERY_S giây từ giây 60).
 * PROBE=0: không poll, không đặt đơn, để hit ratio chỉ gồm tải k6 (lượt poll của bản sau sẽ "nhận hộ" lần trượt sau mỗi lần xóa).
 *   RUN=main ROUNDS=3 DURATION_S=300 CHANGES=40 pnpm bench:rounds   → bench/results/<RUN>/rounds/, <RUN>/hit-ratio-rounds.json
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { round, summarize } from './lib';

const RUN = process.env.RUN ?? 'main';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const DURATION_S = process.env.DURATION_S ?? '300';
const CHANGES = process.env.CHANGES ?? '40';
const variants = ['truoc', 'sau'] as const;
mkdirSync(join('bench/results', RUN, 'rounds'), { recursive: true });

interface Result {
  k6: { requests: number; droppedIterations: number; non200: number };
  hitRatio: { loadAfterWarmup: { hitRatioPct: number; lookups: number; miss: number } };
  db: { pageReadsPerMinAfterWarmup: number; pgStatementsPerMinAfterWarmup: Record<string, number> };
  cpuPct: { postgres: number | null };
  watch: { staleLoadPct: number | null };
  outbox: { events: number; pendingMax: number };
  load: { hostLoad1Min: number; hostLoad1Max: number };
}
const runs: { variant: string; round: number; r: Result }[] = [];
for (let round_ = 1; round_ <= ROUNDS; round_++) {
  const order = round_ % 2 === 1 ? variants : [...variants].reverse();
  for (const variant of order) {
    const name = `r${round_}-${variant}`;
    const env = { ...process.env, RUN: join(RUN, 'rounds'), NAME: name, VARIANT: variant, PROBE: '0', DURATION_S, CHANGES };
    const res = spawnSync(process.execPath, ['--import', 'tsx', 'bench/run-scenario.ts'], { env, encoding: 'utf8' });
    writeFileSync(join('bench/results', RUN, 'rounds', `${name}.stdout`), `${res.stdout}\n${res.stderr}`);
    if (res.status !== 0) throw new Error(`${name} lỗi: ${res.stderr}`);
    const r = JSON.parse(readFileSync(join('bench/results', RUN, 'rounds', `${name}.json`), 'utf8')) as Result;
    runs.push({ variant, round: round_, r });
    console.log(
      `${name}: hit ${r.hitRatio.loadAfterWarmup.hitRatioPct} % · DB ${r.db.pageReadsPerMinAfterWarmup}/phút · CPU PG ${r.cpuPct.postgres} % · giá cũ ${r.watch.staleLoadPct} % · dropped ${r.k6.droppedIterations} · load ${r.load.hostLoad1Min}–${r.load.hostLoad1Max}`,
    );
  }
}
const pick = (v: string, f: (x: Result) => number) => summarize(runs.filter((x) => x.variant === v).map((x) => f(x.r)));
const summary = Object.fromEntries(
  variants.map((v) => [
    v,
    {
      hitRatioPct: pick(v, (x) => x.hitRatio.loadAfterWarmup.hitRatioPct),
      missesAfterWarmup: pick(v, (x) => x.hitRatio.loadAfterWarmup.miss),
      pageReadsPerMin: pick(v, (x) => x.db.pageReadsPerMinAfterWarmup),
      workerStatementsPerMin: pick(v, (x) => x.db.pgStatementsPerMinAfterWarmup.worker_or_outbox ?? 0),
      postgresCpuPct: pick(v, (x) => x.cpuPct.postgres ?? NaN),
      staleLoadPct: pick(v, (x) => x.watch.staleLoadPct ?? NaN),
      dropped: runs.filter((x) => x.variant === v).reduce((a, x) => a + x.r.k6.droppedIterations, 0),
      non200: runs.filter((x) => x.variant === v).reduce((a, x) => a + x.r.k6.non200, 0),
    },
  ]),
);
// Chênh lệch (sau − trước) trong từng vòng: so với dao động giữa các vòng trước khi kết luận.
const diffs = Array.from({ length: ROUNDS }, (_, i) => {
  const t = runs.find((x) => x.round === i + 1 && x.variant === 'truoc')!.r;
  const s = runs.find((x) => x.round === i + 1 && x.variant === 'sau')!.r;
  return {
    round: i + 1,
    hitRatioPts: round(s.hitRatio.loadAfterWarmup.hitRatioPct - t.hitRatio.loadAfterWarmup.hitRatioPct, 2),
    extraMisses: s.hitRatio.loadAfterWarmup.miss - t.hitRatio.loadAfterWarmup.miss,
    pageReadsPerMin: s.db.pageReadsPerMinAfterWarmup - t.db.pageReadsPerMinAfterWarmup,
  };
});
writeFileSync(
  join('bench/results', RUN, 'hit-ratio-rounds.json'),
  JSON.stringify({ env: { ROUNDS, DURATION_S, CHANGES }, summary, diffs, runs: runs.map(({ variant, round: r, r: x }) => ({ variant, round: r, hitRatio: x.hitRatio.loadAfterWarmup, db: x.db, cpu: x.cpuPct, stale: x.watch.staleLoadPct, outbox: x.outbox, k6: x.k6, load: x.load })) }, null, 2),
);
console.log(JSON.stringify({ summary, diffs }, null, 1));
