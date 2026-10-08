/**
 * Build một biến thể trên builder của lab, in tóm tắt log (bước CACHED, byte context, gói tải từ mạng).
 *   pnpm build:naive                         # Dockerfile.naive (hiện trạng), không cache registry
 *   pnpm build:pattern                       # Dockerfile (pattern) + --cache-from/--cache-to registry local
 * Tùy chọn: --builder <tên lab-17-02-…> (mặc định lab-17-02-test), --no-cache, --load (nạp image vào Docker).
 * Mã thoát khác 0 nếu build lỗi.
 */
import { build, ensureBuilder, prepareContext, TEST_BUILDER, type Variant } from './lib/docker.js';

const variant = process.argv[2] as Variant;
if (variant !== 'naive' && variant !== 'pattern') {
  console.error('Dùng: tsx scripts/build.ts naive|pattern [--builder lab-17-02-…] [--no-cache] [--load]');
  process.exit(2);
}
const argv = process.argv.slice(3);
const builder = argv.includes('--builder') ? argv[argv.indexOf('--builder') + 1]! : TEST_BUILDER;
await prepareContext();
await ensureBuilder(builder);
const pattern = variant === 'pattern';
const r = await build({ variant, builder, noCache: argv.includes('--no-cache'), cacheFrom: pattern, cacheTo: pattern, output: argv.includes('--load') ? 'load' : 'none' });
console.log(r.out.split('\n').slice(-30).join('\n'));
for (const s of r.log.steps.filter((x) => /^\[[\w-]+ \d+\/\d+\]/.test(x.name))) {
  console.log(`${s.cached ? 'CACHED' : `${(s.seconds ?? 0).toFixed(1).padStart(5)} s`}  ${s.name.slice(0, 110)}`);
}
console.log(`${r.ok ? '✔' : '✖'} ${variant} · ${(r.ms / 1000).toFixed(1)} s · CACHED ${r.log.cachedSteps}/${r.log.dockerfileSteps} · context ${r.log.contextBytes ?? '?'} B · pnpm tải ${r.log.pnpmDownloaded}, dùng lại ${r.log.pnpmReused}`);
process.exit(r.ok ? 0 : 1);
