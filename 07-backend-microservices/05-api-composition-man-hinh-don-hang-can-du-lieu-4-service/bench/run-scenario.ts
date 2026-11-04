/**
 * Đo một bản: mở màn hình chi tiết ở tốc độ cố định, rồi lặp lại khi shipping chậm quá timeout. Cần Docker.
 * Kết quả: bench/results/<run>/<variant>-*.json. Không ghi đè lượt đã có.
 *   pnpm bench:scenario --variant truoc --run main
 *   pnpm bench:scenario --variant sau --run delay-0 --delay 0 --duration 60 --outage-seconds 0
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '30' },
    duration: { type: 'string', default: '300' },
    'outage-seconds': { type: 'string', default: '60' },
    delay: { type: 'string', default: '40' },
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

const TOXIPROXY = process.env.TOXIPROXY_URL ?? 'http://127.0.0.1:58474';

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PROVIDER_DELAY_MS: values.delay },
    });
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

const compose = (...args: string[]) => run('docker', ['compose', '--profile', 'stack', ...args]);
const power = async () => (await run('pmset', ['-g', 'batt'])).split('\n')[0];

const k6 = (name: string, seconds: string) =>
  compose(
    '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', `VARIANT=${variant}`, '-e', `RATE=${values.rate}`, '-e', `DURATION=${seconds}s`,
    'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variant}-${name}.json`, '/bench/order-detail.k6.js',
  );

async function toxiproxy(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${TOXIPROXY}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    throw new Error(`Toxiproxy ${method} ${path} trả ${response.status}`);
  }
}

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
await k6('normal', values.duration);

if (Number(values['outage-seconds']) > 0) {
  // Độ trễ 5 giây vượt cả timeout của BFF lẫn của client cũ: shipping coi như đang hỏng.
  await toxiproxy('POST', '/proxies/shipping/toxics', {
    name: 'slow_shipping',
    type: 'latency',
    stream: 'downstream',
    attributes: { latency: 5_000, jitter: 0 },
  });
  await k6('shipping-down', values['outage-seconds']);
  await toxiproxy('DELETE', '/proxies/shipping/toxics/slow_shipping');
}
clearInterval(sleepWatch);

writeFileSync(
  join(outDir, `${variant}-meta.json`),
  JSON.stringify({ ...values, loadEnd: loadavg(), powerStart, powerEnd: await power(), sleepGaps }, null, 2),
);
await compose('--profile', 'bench', 'down', '-v');
console.log(`Xong ${variant}; khoảng ngủ: ${sleepGaps.length}`);
