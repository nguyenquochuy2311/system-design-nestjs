/**
 * "Frontend chờ bao lâu để bắt đầu" (README mục 5): từ lúc có spec tới lúc màn hình Chi tiết khách hàng render được
 * trên mock Prism, không cần dòng code backend nào. ROUNDS vòng (mặc định 5).
 *   RUN=main pnpm tsx bench/mock-start.ts     # kết quả: bench/results/<RUN>/mock-start.json
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { CustomerDetail } from '../apps/web/src/sau/customer-detail.js';
import { createApi } from '../apps/web/src/sau/api-client.js';
import { LAB_DIR, SPEC } from '../packages/api-contract/ci/steps.js';
import { renderFields } from '../test/support/render.js';
import { machine, OUT_ROOT, outDir, writeJson } from './lib.js';

outDir('.');
const PORT = Number(process.env.MOCK_PORT ?? 3101);
const rounds = [];
for (let i = 1; i <= Number(process.env.ROUNDS ?? 5); i++) {
  const t0 = performance.now();
  const prism = spawn(join(LAB_DIR, 'node_modules/.bin/prism'), ['mock', '--host', '127.0.0.1', '--port', String(PORT), SPEC], { cwd: LAB_DIR });
  await new Promise<void>((resolve, reject) => {
    let log = '';
    prism.stdout.on('data', (d: Buffer) => { log += d; if (log.includes('Prism is listening')) resolve(); });
    prism.on('exit', (code) => reject(new Error(`Prism thoát ${code}: ${log}`)));
  });
  const listeningMs = performance.now() - t0;
  const fields = renderFields(CustomerDetail, { customer: await createApi(`http://127.0.0.1:${PORT}`).getCustomer('cus_001') });
  const renderedMs = performance.now() - t0;
  prism.kill('SIGTERM');
  await new Promise((r) => prism.once('exit', r));
  rounds.push({ round: i, listeningMs: Math.round(listeningMs), renderedMs: Math.round(renderedMs), name: fields.name });
  console.log(rounds.at(-1));
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const summary = { env: machine(), medianListeningMs: med(rounds.map((r) => r.listeningMs)), medianRenderedMs: med(rounds.map((r) => r.renderedMs)), rounds };
writeJson(join(OUT_ROOT, 'mock-start.json'), summary);
console.log(summary);
