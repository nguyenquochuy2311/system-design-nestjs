/**
 * Đo "trước" (Dockerfile.naive, không cache registry) và "sau" (Dockerfile theo pattern + cache mount + cache registry)
 * trên cùng máy, cùng context giống thư mục làm việc CI/máy dev, builder BuildKit riêng của lab (driver docker-container).
 *   RUN=main ROUNDS=3 pnpm bench:measure
 *   RUN=trial ROUNDS=1 pnpm bench:measure
 * Mỗi vòng, mỗi biến thể (thứ tự xoay giữa các vòng), registry trống:
 *   cold          — builder mới B1 (đã kéo base image), build lần đầu: không layer cache, kho pnpm trống.
 *   code-change   — sửa một dòng trong apps/api/src (nội dung duy nhất), build lại trên B1.
 *   new-builder   — builder mới B2 (mô phỏng runner CI tạm), sửa một dòng khác, build; bản pattern chỉ có --cache-from registry.
 *   add-dependency — trên B1: `pnpm add dayjs@1.11.21` (gói thật từ npm registry), build lại.
 *   add-dependency-warm-store — chỉ bản pattern: lockfile đổi lần nữa (cùng dayjs 1.11.21, specifier `^1.11.21`) để
 *                   fetch/install chạy lại khi kho đã có mọi gói: tách phần tải từ mạng.
 * Kết quả thô: bench/results/<RUN>/measure.json, logs/*.log (log --progress=plain của từng lần build), context.json.
 */
import { writeFileSync } from 'node:fs';
import {
  addDependency, build, contextDirty, createBuilder, editSourceLine, listContext, prepareContext, removeBuilder,
  run, warmBaseImage, type BuildResult, type Variant,
} from '../scripts/lib/docker.js';
import { log, machine, outFile, resetRegistry, rotate, RUN, startSleepDetector, staticEnv, stats, writeJson } from './lib.js';

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const VARIANTS = ['naive', 'pattern'] as const;
type Scenario = 'cold' | 'code-change' | 'new-builder' | 'add-dependency' | 'add-dependency-warm-store';

const sleep = startSleepDetector();
const result: Record<string, unknown> = {
  run: RUN, rounds: ROUNDS, env: await staticEnv(), start: await machine(),
  dockerSystemDfStart: (await run('docker', ['system', 'df'])).out,
};
const rows: Record<string, unknown>[] = [];
const save = () => writeJson('measure.json', { ...result, rows, sleepGaps: sleep.gaps });

await prepareContext();
if (await contextDirty()) throw new Error('context có thay đổi chưa khôi phục');

function record(round: number, variant: Variant, scenario: Scenario, builder: string, r: BuildResult, extra: Record<string, unknown> = {}) {
  if (!r.ok) {
    writeFileSync(outFile(`logs/FAILED-r${round}-${variant}-${scenario}.log`), r.out);
    throw new Error(`build ${variant} ${scenario} lỗi:\n${r.out.slice(-3000)}`);
  }
  writeFileSync(outFile(`logs/r${round}-${variant}-${scenario}.log`), r.out);
  const row = {
    round, variant, scenario, builder, ms: Math.round(r.ms),
    contextBytes: r.log.contextBytes, cachedSteps: r.log.cachedSteps, dockerfileSteps: r.log.dockerfileSteps,
    pnpmDownloaded: r.log.pnpmDownloaded, pnpmReused: r.log.pnpmReused,
    steps: r.log.steps.filter((s) => s.seconds !== null || s.cached).map((s) => ({ name: s.name.slice(0, 140), cached: s.cached, seconds: s.seconds })),
    ...extra,
  };
  rows.push(row);
  log(`  ${variant} ${scenario}: ${(r.ms / 1000).toFixed(1)} s · CACHED ${r.log.cachedSteps}/${r.log.dockerfileSteps} · context ${r.log.contextBytes} B · pnpm tải ${r.log.pnpmDownloaded}`);
  save();
}

async function assertClean() {
  const d = await contextDirty();
  if (d) throw new Error(`context chưa khôi phục: ${d}`);
}

for (let round = 1; round <= ROUNDS; round++) {
  const env = await machine();
  log(`vòng ${round}: nguồn ${env.power}, nắp gập ${env.lidClosed}, load ${env.load.join(' ')}`);
  rows.push({ round, env });
  for (const v of rotate(VARIANTS, round - 1)) {
    const pattern = v === 'pattern';
    const cache = { cacheFrom: pattern, cacheTo: pattern };
    await resetRegistry();
    const b1 = `lab-17-02-m${round}-${v}-1`;
    const c1 = await createBuilder(b1);
    const w1 = await warmBaseImage(b1);
    record(round, v, 'cold', b1, await build({ variant: v, builder: b1, ...cache }), { createBuilderMs: Math.round(c1.ms), baseImageMs: Math.round(w1) });

    let restore = editSourceLine(`${RUN} vòng ${round} ${v} code-change`);
    try { record(round, v, 'code-change', b1, await build({ variant: v, builder: b1, ...cache })); } finally { restore(); }
    await assertClean();

    // [đo] runner tạm: builder mới, không layer cache, không cache mount; bản pattern chỉ có cache registry.
    const b2 = `lab-17-02-m${round}-${v}-2`;
    const c2 = await createBuilder(b2);
    const w2 = await warmBaseImage(b2);
    restore = editSourceLine(`${RUN} vòng ${round} ${v} new-builder`);
    try {
      record(round, v, 'new-builder', b2, await build({ variant: v, builder: b2, ...cache }), { createBuilderMs: Math.round(c2.ms), baseImageMs: Math.round(w2) });
    } finally { restore(); }
    await removeBuilder(b2);
    await assertClean();

    let restoreDep = await addDependency();
    try {
      record(round, v, 'add-dependency', b1, await build({ variant: v, builder: b1, ...cache }));
      if (pattern) {
        await restoreDep();
        // Cùng phiên bản 1.11.21 (đã có trong kho) nhưng specifier khác (`^1.11.21`): lockfile đổi nên fetch chạy lại, không có gì để tải.
        // (Lượt thử dùng `dayjs@^1.11.21` và pnpm chọn 1.11.23 mới hơn, nên vẫn tải 1 gói.)
        restoreDep = await addDependency({ spec: 'dayjs@>=1.11.21 <1.11.22', exact: false });
        record(round, v, 'add-dependency-warm-store', b1, await build({ variant: v, builder: b1, ...cache }));
      }
    } finally { await restoreDep(); }
    await assertClean();
    await removeBuilder(b1);
  }
}

// Tóm tắt: trung vị (thấp nhất – cao nhất) theo biến thể × kịch bản.
const summary: Record<string, Record<string, unknown>> = {};
for (const v of VARIANTS) {
  summary[v] = {};
  for (const sc of ['cold', 'code-change', 'new-builder', 'add-dependency', 'add-dependency-warm-store'] as Scenario[]) {
    const rs = rows.filter((x) => x.variant === v && x.scenario === sc) as { ms: number; contextBytes: number; cachedSteps: number; dockerfileSteps: number; pnpmDownloaded: number }[];
    if (!rs.length) continue;
    summary[v][sc] = {
      ms: stats(rs.map((x) => x.ms)), contextBytes: stats(rs.map((x) => x.contextBytes)),
      cachedSteps: stats(rs.map((x) => x.cachedSteps)), dockerfileSteps: rs[0]!.dockerfileSteps, pnpmDownloaded: stats(rs.map((x) => x.pnpmDownloaded)),
    };
  }
}
result.summary = summary;
save();

// Kích thước build context (toàn bộ, sau khi áp ignore-file của từng Dockerfile), trên builder riêng để không làm ấm B1.
const probe = 'lab-17-02-m-probe';
await createBuilder(probe);
const ctx: Record<string, unknown> = {};
for (const v of VARIANTS) {
  const l = await listContext(v, { builder: probe });
  ctx[v] = { files: l.files.length, totalBytes: l.totalBytes, has: l.has, byTopLevel: l.byTopLevel };
  log(`context ${v}: ${l.files.length} file, ${(l.totalBytes / 1e6).toFixed(2)} MB, ${JSON.stringify(l.has)}`);
}
await removeBuilder(probe);
writeJson('context.json', ctx);
result.end = await machine();
result.dockerSystemDfEnd = (await run('docker', ['system', 'df'])).out;
save();
sleep.stop();
log(`xong · khoảng máy ngủ: ${sleep.gaps.length}`);
