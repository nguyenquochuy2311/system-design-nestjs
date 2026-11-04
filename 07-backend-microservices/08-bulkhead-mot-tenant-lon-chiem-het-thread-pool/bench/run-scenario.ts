/**
 * Đo một bản: (1) khách lớn giữ 30 báo cáo liên tục, (2) khách lớn cần xong đúng 30 báo cáo. Khách nhỏ ghi chú suốt hai lượt.
 * Cần Docker. Kết quả: bench/results/<run>/<variant>-*.json. Không ghi đè lượt đã có.
 *   pnpm bench:scenario --variant truoc --run main
 *   pnpm bench:scenario --variant sau --run trial --duration 30 --batch 6 --batch-duration 40
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '50' },
    duration: { type: 'string', default: '180' },
    batch: { type: 'string', default: '30' },
    'batch-duration': { type: 'string', default: '170' },
  },
});

const variant = values.variant;
if (variant !== 'truoc' && variant !== 'sau') {
  throw new Error('Cần --variant truoc hoặc --variant sau');
}
const outDir = join('bench/results', values.run);
if (existsSync(join(outDir, `${variant}-meta.json`))) {
  throw new Error(`Đã có kết quả ${variant} trong ${outDir}; chọn --run khác để không ghi đè số đã trích`);
}
mkdirSync(outDir, { recursive: true });

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CRM_MODE: variant } });
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

const profiles = variant === 'sau' ? ['--profile', 'stack', '--profile', 'worker'] : ['--profile', 'stack'];
const compose = (...args: string[]) => run('docker', ['compose', ...profiles, ...args]);
const power = async () => (await run('pmset', ['-g', 'batt'])).split('\n')[0];

const k6 = (name: string, mode: string, seconds: string) =>
  compose(
    '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', `MODE=${mode}`, '-e', `RATE=${values.rate}`, '-e', `DURATION=${seconds}s`, '-e', `BATCH=${values.batch}`,
    'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variant}-${name}.json`, '/bench/noisy-neighbor.k6.js',
  );

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
await compose('--profile', 'bench', 'down', '-v');
await compose('up', '-d', '--wait');

const admin = new pg.Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:55432/lab', max: 1 });
let peakConnections = 0;
// Lấy mẫu pg_stat_activity mỗi giây, đúng cách đo của mục 5.
const sampler = setInterval(() => {
  admin
    .query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'crm_app'")
    .then(({ rows }) => {
      peakConnections = Math.max(peakConnections, rows[0]?.n ?? 0);
    })
    .catch(() => undefined);
}, 1_000);

await k6('sustained', 'sustained', values.duration);
const batchStart = performance.now();
await k6('batch', 'batch', values['batch-duration']);
const batchMs = Math.round(performance.now() - batchStart);
clearInterval(sampler);
clearInterval(sleepWatch);

const { rows } = await admin.query("SELECT status, count(*)::int AS n FROM crm.exports GROUP BY status ORDER BY status");
await admin.end();
writeFileSync(
  join(outDir, `${variant}-meta.json`),
  JSON.stringify(
    { ...values, peakConnections, batchMs, exports: rows, loadEnd: loadavg(), powerStart, powerEnd: await power(), sleepGaps },
    null,
    2,
  ),
);
await compose('--profile', 'bench', 'down', '-v');
console.log(`Xong ${variant}; khoảng ngủ: ${sleepGaps.length}`);
