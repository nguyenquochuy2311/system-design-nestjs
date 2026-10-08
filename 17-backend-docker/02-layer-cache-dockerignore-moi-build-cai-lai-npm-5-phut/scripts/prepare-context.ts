/** Dựng build context giống thư mục làm việc của CI/máy dev ở `.tmp/context/` (có `.git`, `node_modules`, `.env` giả). Chạy: pnpm context */
import { CONTEXT_DIR, prepareContext } from './lib/docker.js';

await prepareContext();
console.log(`Context: ${CONTEXT_DIR}`);
