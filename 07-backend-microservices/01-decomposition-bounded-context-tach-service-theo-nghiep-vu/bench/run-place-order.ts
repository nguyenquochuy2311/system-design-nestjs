/**
 * Đo một bản trong mạng Compose: k6 ở tốc độ cố định, đếm service và lời gọi từ log, rồi tắt một service và đo tỉ lệ
 * đặt hàng thành công. Cần Docker. Kết quả: bench/results/<run>/<variant>-*.json. Không ghi đè lượt đã có.
 *   pnpm bench:place-order --variant truoc --run main
 *   pnpm bench:place-order --variant sau --run main --duration 5m --rate 50
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { countHops } from './hop-count';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '50' },
    duration: { type: 'string', default: '5m' },
    'outage-duration': { type: 'string', default: '30s' },
  },
});

const VARIANTS = {
  truoc: { profile: 'truoc', baseUrl: 'http://checkout-api:3000', entry: 'checkout-api', stopped: 'product-service' },
  sau: { profile: 'sau', baseUrl: 'http://ordering:3000', entry: 'ordering', stopped: 'catalog' },
} as const;

const variantName = values.variant;
if (variantName !== 'truoc' && variantName !== 'sau') {
  throw new Error('Cần --variant truoc hoặc --variant sau');
}
const variant = VARIANTS[variantName];
const outDir = join('bench/results', values.run);
const summaryFile = `${variantName}-load.json`;
if (existsSync(join(outDir, summaryFile))) {
  throw new Error(`Đã có ${join(outDir, summaryFile)}; chọn --run khác để không ghi đè số đã trích`);
}
mkdirSync(outDir, { recursive: true });

// Dùng spawn thay cho spawnSync để lượt k6 dài không chặn đồng hồ phát hiện máy ngủ (nhật ký 01/02 điểm 4).
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

const compose = (...args: string[]) => run('docker', ['compose', '--profile', variant.profile, ...args]);

function k6(results: string, duration: string): Promise<string> {
  return run('docker', [
    'compose', '--profile', variant.profile, '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', `BASE_URL=${variant.baseUrl}`, '-e', `RATE=${values.rate}`, '-e', `DURATION=${duration}`,
    'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${results}`, '/bench/place-order.k6.js',
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

await compose('down', '-v');
await compose('up', '-d', '--wait');
const loadBefore = loadavg();
await k6(summaryFile, values.duration);
const loadAfter = loadavg();

const logs = await compose('logs', '--no-log-prefix', '--no-color');
const hops = countHops(logs.split('\n'), variant.entry);

// Dừng đúng một container, để không kéo theo service phụ thuộc vào nó.
const stoppedContainer = (await compose('ps', '-q', variant.stopped)).trim();
await run('docker', ['stop', stoppedContainer]);
await k6(`${variantName}-outage.json`, values['outage-duration']);
clearInterval(sleepWatch);

const power = await run('pmset', ['-g', 'batt']);
writeFileSync(
  join(outDir, `${variantName}-meta.json`),
  JSON.stringify(
    { ...values, stopped: variant.stopped, hops, loadBefore, loadAfter, power: power.split('\n')[0], sleepGaps },
    null,
    2,
  ),
);
await compose('down', '-v');
console.log(`Xong ${variantName}: ${JSON.stringify(hops)}; khoảng ngủ: ${sleepGaps.length}`);
