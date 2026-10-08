/**
 * In build context mà BuildKit nhận cho một Dockerfile (stage context-probe, sau khi áp ignore-file của Dockerfile đó).
 *   pnpm list-context naive | pattern
 */
import { ensureBuilder, listContext, prepareContext, TEST_BUILDER, type Variant } from './lib/docker.js';
import { contextViolations } from './lib/checks.js';

const variant = process.argv[2] as Variant;
if (variant !== 'naive' && variant !== 'pattern') {
  console.error('Dùng: tsx scripts/list-context.ts naive|pattern');
  process.exit(2);
}
await prepareContext();
await ensureBuilder(TEST_BUILDER);
const l = await listContext(variant);
const top = Object.entries(l.byTopLevel).sort((a, b) => b[1].bytes - a[1].bytes);
for (const [name, x] of top) console.log(`${(x.bytes / 1e6).toFixed(3).padStart(10)} MB  ${String(x.files).padStart(6)} file  ${name}`);
const v = contextViolations(l);
console.log(`${variant}: ${l.files.length} file, ${(l.totalBytes / 1e6).toFixed(2)} MB · vi phạm: ${v.join(', ') || 'không'}`);
process.exit(v.length ? 1 : 0);
