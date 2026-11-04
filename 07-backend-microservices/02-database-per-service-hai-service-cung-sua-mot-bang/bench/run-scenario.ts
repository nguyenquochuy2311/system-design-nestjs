/**
 * Đo một bản trong mạng Compose, từ volume sạch: đối chứng không báo cáo, báo cáo thường, báo cáo giữ khóa, rồi migration
 * của shipping trong lúc tạo đơn. Kết quả: bench/results/<run>/<variant>-*.json. Không ghi đè lượt đã có.
 *   pnpm bench:scenario --variant truoc --run main
 *   pnpm bench:scenario --variant sau --run main --duration 2m --rate 30
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { applyMigrations } from '../libs/platform/migrate';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '30' },
    duration: { type: 'string', default: '2m' },
    'migration-duration': { type: 'string', default: '60s' },
    'migration-at': { type: 'string', default: '20' },
    scenarios: { type: 'string', default: 'control,plain,lock,migration' },
  },
});

const VARIANTS = {
  truoc: { profile: 'truoc', orderUrl: 'http://truoc-order:3000', shippingUrl: 'http://truoc-shipping:3000' },
  sau: { profile: 'sau', orderUrl: 'http://order-service:3000', shippingUrl: 'http://shipping-service:3000' },
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

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;

// Dùng spawn thay cho spawnSync để lượt dài không chặn đồng hồ phát hiện máy ngủ (nhật ký 01/02 điểm 4).
function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } });
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

const compose = (args: string[], env?: NodeJS.ProcessEnv) =>
  run('docker', ['compose', '--profile', variant.profile, ...args], env);

const psqlFile = (path: string) =>
  compose(['exec', '-T', 'postgres', 'psql', '-q', '-U', 'postgres', '-d', 'lab', '-v', 'ON_ERROR_STOP=1', '-f', path]);

function k6(name: string, reportMode: string, duration: string): Promise<string> {
  return run('docker', [
    'compose', '--profile', variant.profile, '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', `ORDER_URL=${variant.orderUrl}`, '-e', `SHIPPING_URL=${variant.shippingUrl}`,
    '-e', `RATE=${values.rate}`, '-e', `DURATION=${duration}`, '-e', `REPORT_MODE=${reportMode}`,
    'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variantName}-${name}.json`,
    '/bench/orders-during-report.k6.js',
  ]);
}

// Máy ngủ giữa lượt làm số đo vô nghĩa: hai nhịp 1 giây cách nhau quá 2,5 giây là có khoảng ngủ (nhật ký 04/02 điểm 5).
const sleepGaps: number[] = [];
let lastTick = Date.now();
const sleepWatch = setInterval(() => {
  const now = Date.now();
  if (now - lastTick > 2_500) {
    sleepGaps.push(now - lastTick);
  }
  lastTick = now;
}, 1_000);

await compose(['down', '-v']);
await compose(['up', '-d', '--wait']);
await applyMigrations(
  { connectionString: url('order_rw'), schema: 'ordering', directory: 'apps/order-service/migrations' },
  '001',
);
const shippingTarget = {
  connectionString: url('shipping_rw'),
  schema: 'shipping',
  directory: 'apps/shipping-service/migrations',
};
await applyMigrations(shippingTarget, '001');
await psqlFile('/lab/db/seed.sql');

const admin = new pg.Pool({ connectionString: url('postgres'), max: 2 });

async function queueDepth(): Promise<number> {
  const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM pgmq.q_order_events');
  return rows[0]?.n ?? 0;
}

async function waitForDrain(): Promise<void> {
  while ((await queueDepth()) > 0) {
    await sleep(200);
  }
}

/** Độ trễ từ lúc tạo sự kiện tới lúc bản sao có dữ liệu, trên các đơn phát sinh từ mốc `since`. */
async function replicationLag(since: Date) {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS orders,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lag) * 1000)::numeric, 1) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY lag) * 1000)::numeric, 1) AS p95_ms,
       round((max(lag) * 1000)::numeric, 1) AS max_ms
     FROM (SELECT extract(epoch FROM replicated_at - event_occurred_at) AS lag
           FROM shipping.shipment_orders WHERE event_occurred_at >= $1) AS t`,
    [since],
  );
  return rows[0] as unknown;
}

const meta: Record<string, unknown> = { ...values, loadStart: loadavg() };
const wanted = values.scenarios.split(',');

for (const [name, mode] of [['control', 'none'], ['plain', 'plain'], ['lock', 'lock']] as const) {
  if (!wanted.includes(name)) {
    continue;
  }
  const since = new Date();
  await k6(name, mode, values.duration);
  meta[`load_${name}`] = loadavg();
  if (variantName === 'sau') {
    await waitForDrain();
    meta[`lag_${name}`] = await replicationLag(since);
  }
}

if (wanted.includes('migration')) {
  const load = k6('migration', 'none', values['migration-duration']);
  await sleep(Number(values['migration-at']) * 1_000);
  const migrationStart = performance.now();
  if (variantName === 'truoc') {
    await psqlFile('/lab/db/truoc/split-address.sql');
  } else {
    await applyMigrations(shippingTarget);
  }
  meta.migrationMs = Math.round(performance.now() - migrationStart);
  await load;

  if (variantName === 'sau') {
    meta.queueDepthBeforeDeploy = await queueDepth();
    const deployStart = performance.now();
    await compose(['up', '-d', '--wait', 'shipping-service'], { SHIPPING_ADDRESS_MODEL: 'split' });
    await waitForDrain();
    meta.catchUpMs = Math.round(performance.now() - deployStart);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS missing FROM ordering.orders o
       WHERE NOT EXISTS (SELECT 1 FROM shipping.shipment_orders s WHERE s.order_id = o.id)`,
    );
    meta.missingAfterCatchUp = rows[0].missing;
  }
}

clearInterval(sleepWatch);
await admin.end();
const power = await run('pmset', ['-g', 'batt']);
writeFileSync(
  join(outDir, `${variantName}-meta.json`),
  JSON.stringify({ ...meta, loadEnd: loadavg(), power: power.split('\n')[0], sleepGaps }, null, 2),
);
await compose(['down', '-v']);
console.log(`Xong ${variantName}; khoảng ngủ: ${sleepGaps.length}`);
