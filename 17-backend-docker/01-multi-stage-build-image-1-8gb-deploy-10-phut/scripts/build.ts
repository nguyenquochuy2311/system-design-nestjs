/**
 * Build một bản image từ context giống CI checkout.
 *   pnpm build:single        # Dockerfile.single-stage → lab-17-01/api:single
 *   pnpm build:multi         # Dockerfile --target runtime → lab-17-01/api:multi
 *   pnpm build:test-target   # Dockerfile --target test → lab-17-01/api:test-target (chạy test, không tạo runtime)
 * Thêm `--no-cache` để build lạnh. Mã thoát khác 0 nếu build lỗi.
 */
import { buildImage, DOCKERFILES, IMAGES, imageInfo, prepareContext } from './lib/docker.js';

const variant = process.argv[2];
const noCache = process.argv.includes('--no-cache');
const opts =
  variant === 'single' ? { dockerfile: DOCKERFILES.single, tag: IMAGES.single }
  : variant === 'multi' ? { dockerfile: DOCKERFILES.multi, tag: IMAGES.multi, target: 'runtime' }
  : variant === 'test-target' ? { dockerfile: DOCKERFILES.multi, tag: IMAGES.testTarget, target: 'test', noCacheFilter: 'test' }
  : null;
if (!opts) {
  console.error('Dùng: tsx scripts/build.ts single|multi|test-target [--no-cache]');
  process.exit(2);
}
await prepareContext();
const r = await buildImage({ ...opts, noCache });
console.log(r.out.split('\n').slice(-25).join('\n'));
if (!r.ok) {
  console.error(`✖ build ${variant} lỗi (mã ${r.code})`);
  process.exit(1);
}
const info = await imageInfo(opts.tag);
console.log(`✔ ${opts.tag} · ${(r.ms / 1000).toFixed(1)} s · ${(info.size / 1e6).toFixed(1)} MB · ${info.layers} layer · user "${info.user || 'root'}"`);
