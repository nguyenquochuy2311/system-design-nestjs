/** Smoke test một image: chạy container, gọi /health. Chạy: pnpm smoke lab-17-01/api:multi */
import { smokeTest } from './lib/docker.js';

const ref = process.argv[2];
if (!ref) {
  console.error('Dùng: tsx scripts/smoke-test.ts <image>');
  process.exit(2);
}
const r = await smokeTest(ref);
if (r.ok) console.log(`✔ ${ref}: /health ${r.status} ${JSON.stringify(r.body)} sau ${(r.ms / 1000).toFixed(1)} s`);
else {
  console.error(`✖ ${ref}: ${r.reason}\n${r.logs.split('\n').slice(-15).join('\n')}`);
  process.exit(1);
}
