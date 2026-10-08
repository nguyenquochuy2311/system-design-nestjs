/**
 * Đo chỉ số chính của bài: số thay đổi phá vỡ bị chặn trước khi tới người dùng (x/10), trước và sau.
 *   RUN=main pnpm bench:drills            # kết quả: bench/results/<RUN>/drills/
 *   ONLY=1,9 RUN=trial pnpm bench:drills  # chạy thử vài thay đổi
 * Với mỗi thay đổi trong bench/changes.ts, sửa mã nguồn thật, chạy các bước CI của từng bản, khôi phục:
 *   trước     — CI hiện tại: tsc + test của backend; thêm "người dùng mở màn hình" (bench/runtime-probe.ts)
 *   sau (A)   — chỉ sửa code backend, quên spec: lint, generate + tsc, test hợp đồng, diff
 *   sau (B)   — sửa spec + code backend cho khớp: cùng 4 bước
 * "Bị chặn" = ít nhất một bước đỏ. "Đúng chỗ": tsc đỏ chỉ ở apps/web, diff nhắc đúng trường, test hợp đồng đỏ đúng case.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractTest, diffSpec, generateTypes, GENERATED, LAB_DIR, lintSpec, SPEC, typecheck, type StepResult } from '../packages/api-contract/ci/steps.js';
import { type BreakingChange, CHANGES } from './changes.js';
import { applyEdits, machine, outDir, runProbe, snapshot, truncate, tscErrorFiles, writeJson } from './lib.js';

const OUT = outDir('drills');
const only = process.env.ONLY?.split(',').map(Number);
const changes = only ? CHANGES.filter((c) => only.includes(c.id)) : CHANGES;
const touched = [...new Set([...CHANGES.flatMap((c) => [...c.truoc, ...c.sauCode, ...c.spec].map((e) => e.file)), GENERATED])];
const verifyRestored = snapshot(touched);
const BASE = 'bench/results/' + (process.env.RUN ?? 'main') + '/drills/base-openapi.yaml'; // "spec của nhánh chính"
copyFileSync(join(LAB_DIR, SPEC), join(LAB_DIR, BASE));

const brief = (r: StepResult) => ({ step: r.step, ok: r.ok, exitCode: r.exitCode, ms: Math.round(r.ms), output: truncate(r.output) });

function runBefore(c: BreakingChange) {
  const restore = applyEdits(c.truoc);
  try {
    const tsc = typecheck();
    const backendTest = vitestFile('test/truoc-backend.test.ts');
    const probe = runProbe('truoc');
    return { tsc: brief(tsc), backendTest: brief(backendTest), probe, blocked: !tsc.ok || !backendTest.ok };
  } finally { restore(); }
}

// Test sẵn có của backend bản trước, chạy như một bước CI.
function vitestFile(file: string): StepResult {
  const t0 = performance.now();
  const r = spawnSync(join(LAB_DIR, 'node_modules/.bin/vitest'), ['run', file], { cwd: LAB_DIR, encoding: 'utf8' });
  return { step: 'backend-test', ok: r.status === 0, exitCode: r.status, ms: performance.now() - t0, output: `${r.stdout}${r.stderr}` };
}

function runAfter(c: BreakingChange, variant: 'A' | 'B') {
  const restoreEdits = applyEdits(variant === 'A' ? c.sauCode : [...c.spec, ...c.sauCode]);
  const generated = readFileSync(join(LAB_DIR, GENERATED), 'utf8');
  const restore = () => { restoreEdits(); writeFileSync(join(LAB_DIR, GENERATED), generated); };
  try {
    const lint = lintSpec();
    const gen = generateTypes();
    const tsc = typecheck();
    const contract = contractTest();
    const diff = diffSpec(BASE, SPEC);
    const tscFiles = tscErrorFiles(tsc.output);
    const steps = { lint: brief(lint), generate: brief(gen), tsc: brief(tsc), contract: brief(contract), diff: brief(diff) };
    const red = Object.entries(steps).filter(([, s]) => !s.ok).map(([k]) => k);
    return {
      steps, red, blocked: red.length > 0, tscFiles,
      rightPlace: {
        // backend phải biên dịch (code khớp spec ở B), lỗi nằm ở phía web
        tsc: tsc.ok ? null : tscFiles.some((f) => f.startsWith('apps/web/')) && !tscFiles.some((f) => f.startsWith('apps/backend/')),
        diff: diff.ok ? null : diff.output.includes(c.diffMentions),
        contract: contract.ok ? null : contract.output.includes(c.contractCase),
      },
    };
  } finally { restore(); }
}

const env = { start: machine() };
console.log(`Bắt đầu ${env.start.at} · ${env.start.power} · load ${env.start.load1}`);
const baselineProbe = runProbe('truoc');
type Row = {
  id: number; key: string; title: string;
  before: ReturnType<typeof runBefore> & { runtimeDefect: boolean };
  afterA: ReturnType<typeof runAfter>; afterB: ReturnType<typeof runAfter>;
};
const rows: Row[] = [];
for (const c of changes) {
  const before = runBefore(c);
  const runtimeDefect = !before.probe.ok || JSON.stringify(before.probe.fields) !== JSON.stringify(baselineProbe.fields);
  const a = runAfter(c, 'A');
  const b = runAfter(c, 'B');
  const row: Row = { id: c.id, key: c.key, title: c.title, before: { ...before, runtimeDefect }, afterA: a, afterB: b };
  rows.push(row);
  writeJson(join(OUT, `change-${String(c.id).padStart(2, '0')}-${c.key}.json`), row);
  console.log(`#${c.id} ${c.title}\n   trước: ${before.blocked ? 'CHẶN' : 'lọt'} · màn hình ${runtimeDefect ? 'hỏng' : 'đúng'}` +
    `${before.probe.error ? ` (${before.probe.error})` : ''}\n   sau A: ${a.blocked ? 'CHẶN' : 'lọt'} [${a.red.join(', ')}]` +
    `\n   sau B: ${b.blocked ? 'CHẶN' : 'lọt'} [${b.red.join(', ')}] tsc-file: ${b.tscFiles.join(' ') || '-'}`);
}
const changed = verifyRestored();
const end = machine();
const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
const layer = (v: 'afterA' | 'afterB', step: string) => count((r) => r[v].red.includes(step));
const summary = {
  env: { start: env.start, end, oasdiffImage: process.env.OASDIFF_IMAGE ?? 'tufin/oasdiff:v1.33.0' },
  total: rows.length,
  before: { blocked: count((r) => r.before.blocked), runtimeDefect: count((r) => r.before.runtimeDefect) },
  afterA: { blocked: count((r) => r.afterA.blocked), byLayer: Object.fromEntries(['lint', 'generate', 'tsc', 'contract', 'diff'].map((s) => [s, layer('afterA', s)])) },
  afterB: { blocked: count((r) => r.afterB.blocked), byLayer: Object.fromEntries(['lint', 'generate', 'tsc', 'contract', 'diff'].map((s) => [s, layer('afterB', s)])) },
  rightPlace: rows.map((r) => ({ id: r.id, A: r.afterA.rightPlace, B: r.afterB.rightPlace })),
  matrix: rows.map((r) => ({ id: r.id, key: r.key, before: r.before.blocked, runtimeDefect: r.before.runtimeDefect, A: r.afterA.red, B: r.afterB.red })),
  filesNotRestored: changed,
};
writeJson(join(OUT, 'summary.json'), summary);
console.log(JSON.stringify({ before: summary.before, afterA: summary.afterA, afterB: summary.afterB, filesNotRestored: changed }, null, 2));
if (changed.length) process.exit(1);
