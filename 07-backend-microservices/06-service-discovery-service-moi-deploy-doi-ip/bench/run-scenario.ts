/**
 * Đo một bản. "truoc": IP ghi tay, ba tình huống deploy, thêm máy, tắt máy. "sau": Kubernetes, rollout restart,
 * scale 2 → 5, cờ readiness, và chênh lệch tải với từng tuổi kết nối. Cần Docker.
 * Kết quả: bench/results/<run>/<variant>-*. Không ghi đè lượt đã có.
 *   pnpm bench:scenario --variant truoc --run main
 *   pnpm bench:scenario --variant sau --run trial --skew-seconds 60 --ages 0,1000
 *   pnpm bench:scenario --variant sau --run lag-no-prestop --only-rollouts --lag 5s --strip prestop,retry
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  deploy,
  inEndpointSlice,
  kubectl,
  orderStats,
  pricingPods,
  resetStats,
  rolloutRestart,
  scalePricing,
  setConnectionAge,
  setPodReady,
} from '../test/support/cluster';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rounds: { type: 'string', default: '3' },
    'skew-seconds': { type: 'string', default: '300' },
    ages: { type: 'string', default: '0,3000,1000,500,200' },
    // Giả định người trực mất chừng này để sửa danh sách IP, nhãn minh họa.
    'operator-seconds': { type: 'string', default: '30' },
    // Giả lập quy tắc mạng cập nhật chậm, và gỡ từng lớp để đo tác dụng của lớp đó.
    lag: { type: 'string', default: '1s' },
    strip: { type: 'string', default: '' },
    'only-rollouts': { type: 'boolean', default: false },
  },
});

const variant = values.variant;
if (variant !== 'truoc' && variant !== 'sau') {
  throw new Error('Cần --variant truoc hoặc --variant sau');
}
const runName = values.run;
const outDir = join('bench/results', runName);
if (existsSync(join(outDir, `${variant}-meta.json`))) {
  throw new Error(`Đã có kết quả ${variant} trong ${outDir}; chọn --run khác để không ghi đè số đã trích`);
}
mkdirSync(outDir, { recursive: true });

function run(command: string, args: string[], env: Record<string, string> = {}): Promise<string> {
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

const compose = (args: string[], env: Record<string, string> = {}) => run('docker', ['compose', ...args], env);
const truoc = (args: string[], env: Record<string, string> = {}) => compose(['--profile', 'truoc', ...args], env);
const down = () => compose(['--profile', 'truoc', '--profile', 'bench', 'down', '-v']);
const power = async () => (await run('pmset', ['-g', 'batt'])).split('\n')[0];

const k6 = (name: string, seconds: number, baseUrl: string) =>
  compose([
    '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', `BASE_URL=${baseUrl}`, '-e', `DURATION=${seconds}s`,
    'k6', 'run', '--quiet', '--no-summary', '--out', `csv=/results/${runName}/${variant}-${name}.csv`,
    '/bench/rollout-during-load.k6.js',
  ]);

/** Đọc CSV của k6: mỗi dòng http_reqs là một request, kèm thời điểm và mã trạng thái. */
function tally(name: string) {
  const [header = '', ...lines] = readFileSync(join(outDir, `${variant}-${name}.csv`), 'utf8').trim().split('\n');
  const columns = header.split(',');
  const [metric, time, status] = ['metric_name', 'timestamp', 'status'].map((column) => columns.indexOf(column)) as [
    number,
    number,
    number,
  ];
  const requests = lines
    .map((line) => line.split(','))
    .filter((cells) => cells[metric] === 'http_reqs')
    .map((cells) => ({ at: Number(cells[time]), status: cells[status] ?? '' }));
  const failed = requests.filter((request) => request.status !== '200');
  const start = requests[0]?.at ?? 0;
  const byStatus: Record<string, number> = {};
  for (const request of requests) {
    byStatus[request.status] = (byStatus[request.status] ?? 0) + 1;
  }
  return {
    total: requests.length,
    failed: failed.length,
    byStatus,
    firstFailSecond: failed.length > 0 ? (failed[0]?.at ?? 0) - start : null,
    lastFailSecond: failed.length > 0 ? (failed.at(-1)?.at ?? 0) - start : null,
  };
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

// Pod order vừa thay: chờ NodePort thôi trỏ về pod cũ, không thì vài request đầu của phía đo treo tới timeout.
const ORDER_SETTLE_MS = 10_000;
const BEFORE_URL = 'http://order-truoc:3000';
const OLD_TARGETS = 'http://172.30.0.11:3000,http://172.30.0.12:3000';
const NEW_IP = '172.30.0.21';
const NEW_TARGETS = `http://${NEW_IP}:3000,http://172.30.0.12:3000`;

async function startBefore(): Promise<void> {
  await down();
  await truoc(['up', '-d', 'pricing-a', 'pricing-b', 'order-truoc']);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const reply = await fetch('http://127.0.0.1:3101/quote?km=1').catch(() => undefined);
    if (reply?.status === 200) {
      return;
    }
    await sleep(500);
  }
  throw new Error('order-truoc chưa trả lời');
}

async function measureBefore() {
  const operatorSeconds = Number(values['operator-seconds']);

  // Deploy: pricing-a lên với IP mới. Người trực sửa danh sách rồi tạo lại order sau một khoảng giả định.
  await startBefore();
  const deployLoad = k6('deploy', 40 + operatorSeconds + 20, BEFORE_URL);
  await sleep(20_000);
  await truoc(['up', '-d', 'pricing-a'], { PRICING_A_IP: NEW_IP });
  await sleep(operatorSeconds * 1_000);
  await truoc(['up', '-d', 'order-truoc'], { PRICING_A_IP: NEW_IP, PRICING_TARGETS: NEW_TARGETS });
  await deployLoad;
  const deployResult = tally('deploy');

  // Thêm máy: pricing-c chạy nhưng không có trong danh sách.
  await startBefore();
  const addLoad = k6('add', 40, BEFORE_URL);
  await sleep(5_000);
  await truoc(['up', '-d', 'pricing-c']);
  await addLoad;
  const added = (await truoc(['ps', '-q', 'pricing-c'])).trim().slice(0, 12);
  const addStats = await orderStats('http://127.0.0.1:3101');

  // Tắt máy: pricing-b ngừng và không ai sửa.
  await startBefore();
  const stopLoad = k6('stop', 60, BEFORE_URL);
  await sleep(15_000);
  await truoc(['stop', 'pricing-b']);
  await stopLoad;

  return {
    targets: OLD_TARGETS,
    operatorSeconds,
    deploy: deployResult,
    add: {
      result: tally('add'),
      podsServing: Object.keys(addStats.byPod).length,
      addedPodRequests: addStats.byPod[added]?.count ?? 0,
    },
    stop: tally('stop'),
  };
}

async function measureRollouts() {
  const results = [];
  for (let round = 1; round <= Number(values.rounds); round += 1) {
    const name = `rollout-${round}`;
    const load = k6(name, 60, 'http://k3s:30080');
    await sleep(8_000);
    const startedAt = performance.now();
    await rolloutRestart();
    const rolloutMs = Math.round(performance.now() - startedAt);
    await load;
    results.push({ rolloutMs, ...tally(name) });
  }
  return results;
}

async function measureScale() {
  const name = 'scale';
  await scalePricing(2);
  const before = new Set((await pricingPods()).map((pod) => pod.name));
  const load = k6(name, 60, 'http://k3s:30080');
  await sleep(8_000);
  await resetStats();
  await scalePricing(5);
  await load;
  const stats = await orderStats();
  const fresh = (await pricingPods()).filter((pod) => !before.has(pod.name));
  await scalePricing(2);
  return {
    ...tally(name),
    pods: fresh.map((pod) => ({
      firstRequestAfterReadyMs: stats.byPod[pod.name] ? (stats.byPod[pod.name]?.firstAt ?? 0) - pod.readyAt : null,
      requests: stats.byPod[pod.name]?.count ?? 0,
    })),
  };
}

async function measureReadiness() {
  const results = [];
  for (let round = 1; round <= Number(values.rounds); round += 1) {
    const name = `readiness-${round}`;
    await resetStats();
    const load = k6(name, 40, 'http://k3s:30080');
    await sleep(8_000);
    const { byPod } = await orderStats();
    const podName = Object.entries(byPod).sort(([, a], [, b]) => b.lastAt - a.lastAt)[0]?.[0] as string;
    const pod = (await pricingPods()).find((candidate) => candidate.name === podName);
    if (!pod) {
      throw new Error(`Không thấy pod ${podName}`);
    }

    const flaggedAt = await setPodReady(pod.name, false);
    const polledFrom = performance.now();
    while (await inEndpointSlice(pod.ip)) {
      await sleep(100);
    }
    const endpointRemovedMs = Math.round(performance.now() - polledFrom);
    await load;

    const lastAt = (await orderStats()).byPod[pod.name]?.lastAt ?? 0;
    const restarts = (await pricingPods()).find((candidate) => candidate.name === pod.name)?.restarts;
    await setPodReady(pod.name, true);
    await sleep(5_000);
    results.push({ endpointRemovedMs, lastRequestMs: lastAt - flaggedAt, restartsBefore: pod.restarts, restarts, ...tally(name) });
  }
  return results;
}

async function measureSkew(ageMs: number) {
  const seconds = Number(values['skew-seconds']);
  const name = `skew-${ageMs}`;
  await scalePricing(2);
  await setConnectionAge(ageMs);
  await sleep(ORDER_SETTLE_MS);
  const load = k6(name, seconds + 30, 'http://k3s:30080');
  await sleep(5_000);
  await scalePricing(5);
  await resetStats();
  await sleep(seconds * 1_000);
  const stats = await orderStats();
  await load;
  const counts = (await pricingPods()).map((pod) => stats.byPod[pod.name]?.count ?? 0).sort((a, b) => b - a);
  const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
  const spreadPercent = (((counts[0] ?? 0) - (counts.at(-1) ?? 0)) / mean) * 100;
  return { ageMs, seconds, counts, spreadPercent: Math.round(spreadPercent * 10) / 10, ...tally(name) };
}

async function stripLayers(): Promise<void> {
  const layers = String(values.strip).split(',');
  if (layers.includes('prestop')) {
    const remove = '[{"op":"remove","path":"/spec/template/spec/containers/0/lifecycle"}]';
    await kubectl('-n', 'logistics', 'patch', 'deployment/pricing', '--type=json', '-p', remove);
    await kubectl('-n', 'logistics', 'rollout', 'status', 'deployment/pricing', '--timeout=200s');
  }
  if (layers.includes('retry')) {
    await kubectl('-n', 'logistics', 'set', 'env', 'deployment/order', 'PRICING_RETRIES=0');
    await kubectl('-n', 'logistics', 'rollout', 'status', 'deployment/order', '--timeout=200s');
  }
  await setConnectionAge(1_000);
  await sleep(ORDER_SETTLE_MS);
}

async function measureAfter() {
  await down();
  await compose(['up', '-d', '--wait'], { KUBE_PROXY_MIN_SYNC: String(values.lag) });
  await deploy(2);
  await stripLayers();
  const rollouts = await measureRollouts();
  if (values['only-rollouts']) {
    return { rollouts };
  }
  const scale = await measureScale();
  const readiness = await measureReadiness();
  const skew = [];
  for (const age of String(values.ages).split(',')) {
    skew.push(await measureSkew(Number(age)));
  }
  return { rollouts, scale, readiness, skew };
}

const powerStart = await power();
const result = variant === 'truoc' ? await measureBefore() : await measureAfter();
clearInterval(sleepWatch);
writeFileSync(
  join(outDir, `${variant}-meta.json`),
  JSON.stringify({ ...values, ...result, loadEnd: loadavg(), powerStart, powerEnd: await power(), sleepGaps }, null, 2),
);
await down();
console.log(`Xong ${variant}; khoảng ngủ: ${sleepGaps.length}`);
