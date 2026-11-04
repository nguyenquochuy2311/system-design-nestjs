/**
 * Đo một bản: k6 chạy suốt, Toxiproxy làm promotion chậm 30 giây ở OUTAGE_AT, gỡ ở RECOVER_AT. Cần Docker.
 * Kết quả: bench/results/<run>/<variant>-load.json và -meta.json. Không ghi đè lượt đã có.
 *   pnpm bench:slow-promotion --variant truoc --run main
 *   pnpm bench:slow-promotion --variant sau --run trial --duration 60 --outage-at 15 --recover-at 45
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '25' },
    duration: { type: 'string', default: '300' },
    'outage-at': { type: 'string', default: '60' },
    'recover-at': { type: 'string', default: '240' },
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
const SETTLE_SECONDS = 15;
const outageAt = Number(values['outage-at']);
const recoverAt = Number(values['recover-at']);

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

const compose = (args: string[]) => run('docker', ['compose', ...args], { CHECKOUT_MODE: variant });

async function toxiproxy(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${TOXIPROXY}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    throw new Error(`Toxiproxy ${method} ${path} trả ${response.status}`);
  }
}

async function promotionRequests(): Promise<number> {
  const metrics = await (await fetch('http://127.0.0.1:3101/metrics')).text();
  return Number(/^promotion_requests_total (\d+)/m.exec(metrics)?.[1] ?? 0);
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

await compose(['down', '-v']);
await compose(['up', '-d', '--wait']);

const load = compose([
  '--profile', 'bench', 'run', '--rm', '--no-deps',
  '-e', 'BASE_URL=http://checkout:3000', '-e', `RATE=${values.rate}`, '-e', `DURATION=${values.duration}s`,
  '-e', `OUTAGE_AT=${outageAt}`, '-e', `RECOVER_AT=${recoverAt}`, '-e', `SETTLE_SECONDS=${SETTLE_SECONDS}`,
  'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variant}-load.json`,
  '/bench/checkout-with-slow-promotion.k6.js',
]);
// k6 cần một lúc để khởi động: tính mốc từ request đầu tiên tới promotion, để sự cố bật đúng giai đoạn k6 đang đếm.
while ((await promotionRequests()) === 0) {
  await sleep(20);
}
const startedAt = Date.now();
const untilSecond = (second: number) => sleep(Math.max(0, startedAt + second * 1_000 - Date.now()));

await untilSecond(outageAt);
const outageStartedAt = new Date();
// Độ trễ ở chiều promotion trả về: request vẫn tới promotion, nên bộ đếm của promotion thấy đúng số lời gọi đổ vào nó.
await toxiproxy('POST', '/proxies/promotion/toxics', {
  name: 'slow_promotion',
  type: 'latency',
  stream: 'downstream',
  attributes: { latency: 30_000, jitter: 0 },
});

await untilSecond(outageAt + SETTLE_SECONDS);
const countAtSettle = await promotionRequests();
const settleAt = Date.now();
await untilSecond(recoverAt);
const countAtRecover = await promotionRequests();
const settledSeconds = (Date.now() - settleAt) / 1_000;
const recoveredAt = new Date();
await toxiproxy('DELETE', '/proxies/promotion/toxics/slow_promotion');
await load;
clearInterval(sleepWatch);

const logs = await compose(['logs', '--no-log-prefix', '--no-color', 'checkout']);
const transitions = logs
  .split('\n')
  .filter((line) => line.includes('circuit_state_changed'))
  .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as { timestamp: string; state: string });

const firstOpen = transitions.find((item) => item.state === 'open' && new Date(item.timestamp) >= outageStartedAt);
const firstCloseAfterRecover = transitions.find(
  (item) => item.state === 'close' && new Date(item.timestamp) >= recoveredAt,
);
const power = await run('pmset', ['-g', 'batt']);
writeFileSync(
  join(outDir, `${variant}-meta.json`),
  JSON.stringify(
    {
      ...values,
      secondsToOpen: firstOpen ? (new Date(firstOpen.timestamp).getTime() - outageStartedAt.getTime()) / 1_000 : null,
      secondsToClose: firstCloseAfterRecover
        ? (new Date(firstCloseAfterRecover.timestamp).getTime() - recoveredAt.getTime()) / 1_000
        : null,
      promotionRequestsPerMinuteDuringOutage: ((countAtRecover - countAtSettle) / settledSeconds) * 60,
      transitions,
      loadEnd: loadavg(),
      power: power.split('\n')[0],
      sleepGaps,
    },
    null,
    2,
  ),
);
await compose(['down', '-v']);
console.log(`Xong ${variant}; khoảng ngủ: ${sleepGaps.length}`);
