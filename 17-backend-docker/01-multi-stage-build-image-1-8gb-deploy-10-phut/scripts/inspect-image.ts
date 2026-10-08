/**
 * Kiểm nội dung thật của image: TypeScript, mã nguồn, .git, devDependency, pnpm, thư mục lạ trong /app, user.
 * Chạy: pnpm inspect-image lab-17-01/api:multi   (mã thoát 1 nếu có vi phạm)
 */
import { checkRuntimeContents, devDependencyNames, imageInfo, listImageFiles, prepareContext, processUid } from './lib/docker.js';

const ref = process.argv[2];
if (!ref) {
  console.error('Dùng: tsx scripts/inspect-image.ts <image>');
  process.exit(2);
}
await prepareContext();
const [files, info, uid] = await Promise.all([listImageFiles(ref), imageInfo(ref), processUid(ref)]);
const violations = checkRuntimeContents(files, devDependencyNames());
if (uid === '0') violations.push({ kind: 'root', detail: 'tiến trình chạy bằng root (uid 0)' });
console.log(`${ref}: ${files.length} đường dẫn · ${(info.size / 1e6).toFixed(1)} MB · ${info.layers} layer · uid ${uid}`);
for (const x of violations) console.log(`  ✖ ${x.kind}: ${x.detail}`);
if (violations.length) process.exit(1);
console.log('  ✔ không có vi phạm');
