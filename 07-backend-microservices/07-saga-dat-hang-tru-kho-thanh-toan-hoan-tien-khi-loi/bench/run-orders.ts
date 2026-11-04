/**
 * Đo một bản: 10.000 đơn ở 30 đơn/giây, 5 % bị từ chối, 2 % timeout, kill order-service 3 lần, rồi đối soát ba nơi.
 * Cần Docker. Kết quả: bench/results/<run>/<variant>-*.json. Không ghi đè lượt đã có.
 *   pnpm bench:orders --variant truoc --run main
 *   pnpm bench:orders --variant sau --run trial --duration 40 --kills 10,25
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { reconcile } from '../libs/reconcile';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '30' },
    duration: { type: 'string', default: '334' },
    kills: { type: 'string', default: '67,163,271' },
  },
});

const VARIANTS = {
  truoc: { baseUrl: 'http://truoc-order:3000', orderService: 'truoc-order' },
  sau: { baseUrl: 'http://order-service:3000', orderService: 'order-service' },
} as const;

const variantName = values.variant;
if (variantName !== 'truoc' && variantName !== 'sau') {
  throw new Error('Cần --variant truoc hoặc --variant sau');
}
const variant = VARIANTS[variantName];
const outDir = join('bench/results', values.run);
if (existsSync(join(outDir, `${variantName}-meta.json`))) {
  throw new Error(`Đã có kết quả ${variantName} trong ${outDir}; chọn --run khác để không ghi đè số đã trích`);
}
mkdirSync(outDir, { recursive: true });

const GATEWAY = 'http://127.0.0.1:3102';

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(new Error(`${command} ${args.join(' ')} thoát mã ${code}`));
      }
    });
  });
}

const compose = (...args: string[]) => run('docker', ['compose', '--profile', variantName, ...args]);
const power = async () => (await run('pmset', ['-g', 'batt'])).split('\n')[0];

// Máy ngủ giữa lượt làm số đo vô nghĩa (nhật ký 04/02 điểm 5).
const sleepGaps: number[] = [];
let lastTick = Date.now();
const sleepWatch = setInterval(() => {
  const now = Date.now();
  if (now - lastTick > 2_500) {
    sleepGaps.push(now - lastTick);
  }
  lastTick = now;
}, 1_000);

const powerStart = await power();
await compose('down', '-v');
await compose('up', '-d', '--wait');

const load = compose(
  '--profile', 'bench', 'run', '--rm', '--no-deps',
  '-e', `BASE_URL=${variant.baseUrl}`, '-e', `RATE=${values.rate}`, '-e', `DURATION=${values.duration}s`,
  'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variantName}-load.json`, '/bench/place-orders.k6.js',
);
const startedAt = Date.now();

const killedAt: number[] = [];
for (const second of values.kills.split(',').filter(Boolean).map(Number)) {
  await sleep(Math.max(0, startedAt + second * 1_000 - Date.now()));
  const container = (await compose('ps', '-q', variant.orderService)).trim();
  await run('docker', ['kill', container]);
  killedAt.push(second);
  await sleep(3_000);
  await compose('up', '-d', '--wait', '--no-deps', variant.orderService);
}
await load;

const admin = new pg.Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:55432/lab', max: 2 });
const settleStart = performance.now();
let report = await reconcile(admin, GATEWAY, variantName);
// Bản sau cần chờ saga đang chạy kết thúc. Bản trước không có gì để chờ: đơn treo sẽ treo mãi.
while (variantName === 'sau' && report.unfinished > 0 && performance.now() - settleStart < 120_000) {
  await sleep(500);
  report = await reconcile(admin, GATEWAY, variantName);
}
const settleMs = Math.round(performance.now() - settleStart);

const release =
  variantName === 'sau'
    ? (
        await admin.query(
          `SELECT count(*)::int AS sagas,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ms))::numeric, 1) AS p50_ms,
             round((percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::numeric, 1) AS p95_ms,
             round(max(ms)::numeric, 1) AS max_ms
           FROM (SELECT extract(epoch FROM r.at - f.at) * 1000 AS ms
                 FROM ordering.order_saga_transitions f
                 JOIN ordering.order_saga_transitions r ON r.saga_id = f.saga_id AND r.event = 'StockReleased'
                 WHERE f.event = 'PaymentFailed') AS t`,
        )
      ).rows[0]
    : null;
await admin.end();
clearInterval(sleepWatch);

writeFileSync(
  join(outDir, `${variantName}-meta.json`),
  JSON.stringify(
    { ...values, killedAt, report, settleMs, release, loadEnd: loadavg(), powerStart, powerEnd: await power(), sleepGaps },
    null,
    2,
  ),
);
await compose('down', '-v');
console.log(`Xong ${variantName}; khoảng ngủ: ${sleepGaps.length}`);
