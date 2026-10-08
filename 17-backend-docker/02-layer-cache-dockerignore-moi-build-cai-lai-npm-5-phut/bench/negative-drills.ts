/**
 * Phép thử âm: gỡ từng phần của pattern trên bản sao context, chạy lại đúng phép kiểm của test (a)/(b) hoặc kịch bản
 * builder mới, xác nhận kết quả THẬT SỰ đổi; context khôi phục khớp byte sau mỗi phép thử (git status rỗng).
 *   RUN=main pnpm bench:negative      → bench/results/<RUN>/negative.json
 * Phép thử:
 *   control              — Dockerfile + .dockerignore nguyên bản: (a) xanh, (b) xanh.
 *   copy-all-before-install — `COPY . .` thay cho `COPY pnpm-lock.yaml …` ở đầu stage deps → (b) đỏ.
 *   no-dockerignore      — xóa .dockerignore → (a) đỏ (node_modules, .git, .env).
 *   env-not-ignored      — bỏ dòng `.env` khỏi .dockerignore (context có .env giả) → (a) đỏ ở .env.
 *   no-cache-from        — builder mới, sửa src, build KHÔNG --cache-from → không bước nào CACHED (đối chứng: có --cache-from).
 *   offline-deploy       — builder mới, sửa packages/shared (deps vẫn trúng cache registry, deploy phải chạy lại với kho trống):
 *                          `pnpm deploy --offline` lỗi, `--prefer-offline` (Dockerfile nguyên bản) tải lại gói production.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyEdits, build, CONTEXT_DIR, contextDirty, createBuilder, editSourceLine, findStep, prepareContext, removeBuilder,
  run, warmBaseImage,
} from '../scripts/lib/docker.js';
import { checkContext, srcEditReport } from '../scripts/lib/checks.js';
import { log, machine, resetRegistry, RUN, startSleepDetector, writeJson } from './lib.js';

const sleep = startSleepDetector();
const drills: Record<string, unknown>[] = [];
const result: Record<string, unknown> = { run: RUN, start: await machine() };
const save = () => writeJson('negative.json', { ...result, drills, sleepGaps: sleep.gaps });
await prepareContext();

const builder = 'lab-17-02-neg';
await createBuilder(builder);
await resetRegistry();

async function drill(name: string, expected: string, fn: () => Promise<Record<string, unknown> & { matched: boolean }>) {
  const t0 = Date.now();
  let out: Record<string, unknown> & { matched: boolean };
  try {
    out = await fn();
  } finally {
    // Khôi phục mọi file đã theo dõi trong context (kể cả .dockerignore đã xóa), rồi kiểm khớp byte.
    await run('git', ['checkout', '--', '.'], { cwd: CONTEXT_DIR });
  }
  const dirty = await contextDirty();
  drills.push({ name, expected, ...out, contextRestored: dirty === '', seconds: Math.round((Date.now() - t0) / 1000) });
  log(`${out.matched ? '✔' : '✖'} ${name}: ${JSON.stringify(out).slice(0, 220)}`);
  save();
}

const pick = (r: Awaited<ReturnType<typeof srcEditReport>>) => ({
  ok: r.ok, fetchCached: r.fetchCached, installCached: r.installCached, deployCached: r.deployCached, apiBuildCached: r.apiBuildCached,
  pnpmDownloaded: r.edited.log.pnpmDownloaded, editedMs: Math.round(r.edited.ms),
});

await drill('control', '(a) không vi phạm; (b) install CACHED', async () => {
  const a = await checkContext('pattern', { builder });
  const b = await srcEditReport('pattern', { builder });
  return { violations: a.violations, contextBytes: a.listing.totalBytes, ...pick(b), matched: a.violations.length === 0 && b.installCached === true };
});

await drill('copy-all-before-install', '(b) đỏ: install không CACHED', async () => {
  applyEdits([{ file: 'apps/api/Dockerfile', from: 'COPY pnpm-lock.yaml pnpm-workspace.yaml ./\n', to: 'COPY . .\n' }]);
  const b = await srcEditReport('pattern', { builder });
  return { ...pick(b), matched: b.ok && b.installCached === false };
});

await drill('no-dockerignore', '(a) đỏ: node_modules, .git, .env', async () => {
  rmSync(join(CONTEXT_DIR, '.dockerignore'));
  const a = await checkContext('pattern', { builder });
  // Build thật vẫn chạy? (COPY chọn lọc nên phần lớn context không được chuyển; ghi byte context và kết quả.)
  const r = await build({ variant: 'pattern', builder });
  return {
    violations: a.violations, contextBytes: a.listing.totalBytes, files: a.listing.files.length,
    buildOk: r.ok, buildContextBytes: r.log.contextBytes, matched: ['node_modules', '.git', '.env'].every((x) => a.violations.includes(x as never)),
  };
});

await drill('env-not-ignored', '(a) đỏ: .env (node_modules, .git vẫn bị loại)', async () => {
  applyEdits([{ file: '.dockerignore', from: '\n.env\n', to: '\n' }]);
  const a = await checkContext('pattern', { builder });
  return { violations: a.violations, matched: a.violations.length === 1 && a.violations[0] === '.env' };
});

// Hai phép thử sau cần cache registry của trạng thái hiện tại: xuất cache từ builder neg.
const seed = await build({ variant: 'pattern', builder, cacheTo: true });
if (!seed.ok) throw new Error(`xuất cache: ${seed.out.slice(-2000)}`);

await drill('no-cache-from', 'builder mới không --cache-from: 0 bước CACHED (đối chứng có --cache-from: nhiều bước CACHED)', async () => {
  const res: Record<string, unknown> = {};
  for (const withCache of [true, false]) {
    const b = `lab-17-02-neg-${withCache ? 'cache' : 'nocache'}`;
    await createBuilder(b);
    await warmBaseImage(b);
    const restore = editSourceLine(`${RUN} neg ${withCache}`);
    try {
      const r = await build({ variant: 'pattern', builder: b, cacheFrom: withCache });
      res[withCache ? 'withCacheFrom' : 'withoutCacheFrom'] = {
        ok: r.ok, ms: Math.round(r.ms), cachedSteps: r.log.cachedSteps, dockerfileSteps: r.log.dockerfileSteps, pnpmDownloaded: r.log.pnpmDownloaded,
        cachedNonFrom: r.log.steps.filter((s) => s.cached && /^\[[\w-]+ \d+\/\d+\]/.test(s.name) && !/\] FROM /.test(s.name)).length,
      };
    } finally { restore(); }
    await removeBuilder(b);
  }
  const w = res.withCacheFrom as { cachedSteps: number };
  const wo = res.withoutCacheFrom as { cachedNonFrom: number };
  return { ...res, matched: w.cachedSteps > 10 && wo.cachedNonFrom === 0 };
});

await drill('offline-deploy', 'builder mới + sửa packages/shared: deploy chạy lại với kho trống; `--offline` lỗi, `--prefer-offline` qua', async () => {
  const res: Record<string, unknown> = {};
  for (const flag of ['--prefer-offline', '--offline']) {
    const b = `lab-17-02-neg-${flag.replace(/-/g, '')}`;
    await createBuilder(b);
    await warmBaseImage(b);
    const restore = applyEdits([
      { file: 'packages/shared/src/index.ts', from: '/** Báo cáo sức khỏe dùng chung', to: `// sửa thư viện chung: ${Date.now()}\n/** Báo cáo sức khỏe dùng chung` },
      ...(flag === '--offline'
        ? [{ file: 'apps/api/Dockerfile', from: 'deploy --prod --prefer-offline', to: 'deploy --prod --offline' }]
        : []),
    ]);
    try {
      const r = await build({ variant: 'pattern', builder: b, cacheFrom: true });
      res[flag] = {
        ok: r.ok, fetchCached: findStep(r.log, /pnpm fetch/)?.cached ?? null, installCached: findStep(r.log, /pnpm install/)?.cached ?? null,
        deployCached: findStep(r.log, /deploy/)?.cached ?? null, pnpmDownloaded: r.log.pnpmDownloaded,
        error: /ERR_PNPM_[A-Z_]+/.exec(r.out)?.[0] ?? null, ms: Math.round(r.ms),
      };
    } finally { restore(); }
    await removeBuilder(b);
  }
  const p = res['--prefer-offline'] as { ok: boolean; installCached: boolean };
  const o = res['--offline'] as { ok: boolean; installCached: boolean };
  return { ...res, matched: p.ok && p.installCached && !o.ok && o.installCached };
});

await removeBuilder(builder);
result.end = await machine();
save();
sleep.stop();
const bad = drills.filter((d) => !d.matched || !d.contextRestored);
log(`${drills.length - bad.length}/${drills.length} phép thử đúng kỳ vọng · khoảng máy ngủ: ${sleep.gaps.length}`);
process.exit(bad.length ? 1 : 0);
