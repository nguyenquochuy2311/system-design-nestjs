/**
 * Thời gian 4 bước hợp đồng của CI (README mục 5): 1 vòng làm nóng (không tính) + ROUNDS vòng (mặc định 5), trung vị.
 *   RUN=main pnpm bench:ci-time        # kết quả: bench/results/<RUN>/ci-timing.json
 * Mỗi vòng chạy đúng các bước như `pnpm contract:ci` trên spec hiện tại (PR không đổi spec: diff với chính nó).
 */
import { join } from 'node:path';
import { contractTest, diffSpec, generateTypes, lintSpec, SPEC, typecheck, type StepResult } from '../packages/api-contract/ci/steps.js';
import { machine, OUT_ROOT, outDir, writeJson } from './lib.js';

outDir('.');
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const STEPS: Array<[string, () => StepResult]> = [
  ['lint', () => lintSpec()],
  ['generate', () => generateTypes()],
  ['tsc', () => typecheck()],
  ['contract-test', () => contractTest()],
  ['diff', () => diffSpec(SPEC, SPEC)],
];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

const rounds: Array<{ round: number; env: ReturnType<typeof machine>; ms: Record<string, number>; totalMs: number }> = [];
for (let round = 0; round <= ROUNDS; round++) {
  const env = machine();
  const ms: Record<string, number> = {};
  for (const [name, fn] of STEPS) {
    const r = fn();
    if (!r.ok) throw new Error(`Bước ${name} đỏ ở vòng ${round}:\n${r.output}`);
    ms[name] = Math.round(r.ms);
  }
  const totalMs = Object.values(ms).reduce((a, b) => a + b, 0);
  console.log(`${round === 0 ? 'làm nóng' : `vòng ${round}`}: ${JSON.stringify(ms)} tổng ${totalMs} ms · load ${env.load1} · ${env.power.includes('AC') ? 'cắm sạc' : 'pin'}`);
  if (round > 0) rounds.push({ round, env, ms, totalMs });
}
const stat = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
const summary = {
  rounds: ROUNDS,
  steps: Object.fromEntries(STEPS.map(([n]) => [n, stat(rounds.map((r) => r.ms[n]!))])),
  total: stat(rounds.map((r) => r.totalMs)),
  powerSources: [...new Set(rounds.map((r) => (r.env.power.includes('AC') ? 'AC' : 'battery')))],
  load1: { min: Math.min(...rounds.map((r) => r.env.load1)), max: Math.max(...rounds.map((r) => r.env.load1)) },
  rawRounds: rounds,
};
writeJson(join(OUT_ROOT, 'ci-timing.json'), summary);
console.log(JSON.stringify({ steps: summary.steps, total: summary.total, power: summary.powerSources, load1: summary.load1 }, null, 2));
