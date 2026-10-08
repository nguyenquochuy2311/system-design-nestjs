/** Tạo build context giống CI checkout ở `.tmp/context/` (có `.git`). Chạy: pnpm context */
import { CONTEXT_DIR, prepareContext } from './lib/docker.js';

await prepareContext();
console.log(`Context: ${CONTEXT_DIR}`);
