/**
 * Kiểm hai hành vi mà README dựa vào (mục 3.3, 3.4), ghi file thô:
 *   1. Cache mount của kho pnpm giữ qua các lần build thường (lockfile đổi → chỉ tải gói mới), nhưng bước bị
 *      `--no-cache` / `--no-cache-filter` thấy kho trống (pnpm báo reused 0).
 *   2. `pnpm fetch` dựng virtual store `node_modules/.pnpm` ngay trong layer của stage deps (đếm byte trong tar của stage).
 *   RUN=check pnpm bench:check-cache-mount   → bench/results/<RUN>/cache-mount.json (≈ 1,5 phút)
 */
import { addDependency, bash, build, CONTEXT_DIR, contextDirty, createBuilder, prepareContext, removeBuilder, VARIANTS, warmBaseImage } from '../scripts/lib/docker.js';
import { join } from 'node:path';
import { log, machine, RUN, writeJson } from './lib.js';

await prepareContext();
const b = 'lab-17-02-check';
await createBuilder(b);
await warmBaseImage(b);
const out: Record<string, unknown> = { run: RUN, env: await machine() };
const row = (r: Awaited<ReturnType<typeof build>>) => ({ ok: r.ok, ms: Math.round(r.ms), pnpmDownloaded: r.log.pnpmDownloaded, pnpmReused: r.log.pnpmReused,
  fetchProgress: r.out.split('\n').filter((l) => /Progress: resolved .*done/.test(l)).map((l) => l.replace(/^#\d+ [\d.]+ /, '')) });

out.first = row(await build({ variant: 'pattern', builder: b }));
out.noCacheFilterDeps = row(await build({ variant: 'pattern', builder: b, noCacheFilter: 'deps' }));
out.noCache = row(await build({ variant: 'pattern', builder: b, noCache: true }));
const restore = await addDependency();
try {
  out.lockfileChanged = row(await build({ variant: 'pattern', builder: b }));
} finally { await restore(); }
if (await contextDirty()) throw new Error('context chưa khôi phục');

// Byte của node_modules/.pnpm trong filesystem stage deps (layer do `pnpm fetch` tạo; `pnpm install` sau đó chỉ nối link).
const df = join(CONTEXT_DIR, VARIANTS.pattern.dockerfile);
const t = await bash(`docker buildx build --builder ${b} --progress=quiet -f '${df}' --target deps --output type=tar,dest=- '${CONTEXT_DIR}' | tar -tvf - | awk '$NF ~ /^app\\/node_modules\\/\\.pnpm\\// && $1 ~ /^-/ {s+=$5; n++} END {print s, n}'`);
const [bytes, files] = t.out.trim().split(/\s+/).map(Number);
out.depsStageVirtualStore = { ok: t.ok, bytes, files };
await removeBuilder(b);
writeJson('cache-mount.json', out);
log(JSON.stringify(out, null, 1).slice(0, 2500));
