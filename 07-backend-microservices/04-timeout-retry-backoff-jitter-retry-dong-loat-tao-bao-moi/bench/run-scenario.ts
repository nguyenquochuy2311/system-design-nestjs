/**
 * Đo một bản: (1) sự cố đối tác 20 giây, (2) đối tác lỗi lẻ 5 %. Cần Docker.
 * Kết quả: bench/results/<run>/<variant>-*.  Không ghi đè lượt đã có.
 *   pnpm bench:scenario --variant truoc --run main
 *   pnpm bench:scenario --variant sau --run trial --duration 60 --outage-at 20 --outage-seconds 10 --flaky-seconds 20
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
    run: { type: 'string', default: 'trial' },
    rate: { type: 'string', default: '50' },
    duration: { type: 'string', default: '180' },
    'outage-at': { type: 'string', default: '60' },
    'outage-seconds': { type: 'string', default: '20' },
    'flaky-seconds': { type: 'string', default: '60' },
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
const BANK = 'http://127.0.0.1:3101';
const outageAt = Number(values['outage-at']);
const outageSeconds = Number(values['outage-seconds']);

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

const compose = (args: string[]) => run('docker', ['compose', ...args], { WALLET_MODE: variant });

function k6(name: string, seconds: number): Promise<string> {
  return compose([
    '--profile', 'bench', 'run', '--rm', '--no-deps',
    '-e', 'BASE_URL=http://wallet:3000', '-e', `RATE=${values.rate}`, '-e', `DURATION=${seconds}s`,
    'k6', 'run', '--quiet', `--summary-export=/results/${values.run}/${variant}-${name}.json`,
    `--out=json=/results/${values.run}/${variant}-${name}.ndjson`, '/bench/topup-during-partner-outage.k6.js',
  ]);
}

async function toxiproxy(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${TOXIPROXY}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    throw new Error(`Toxiproxy ${method} ${path} trả ${response.status}`);
  }
}

interface BankStats {
  perSecond: Record<string, { transfers: number; lookups: number; accepted: number; rejected: number }>;
  transfers: number;
  duplicates: number;
}

async function reconcileState() {
  const metrics = await (await fetch('http://127.0.0.1:3100/metrics')).text();
  const read = (pattern: RegExp) => Number(pattern.exec(metrics)?.[1] ?? 0);
  return {
    depth: read(/^wallet_reconcile_queue_depth (\d+)/m),
    completed: read(/^wallet_reconciled_total\{status="COMPLETED"\} (\d+)/m),
    failed: read(/^wallet_reconciled_total\{status="FAILED"\} (\d+)/m),
  };
}

/** Chờ mọi lệnh "đang xử lý" có kết cục, để không kết luận chỉ từ phản hồi nhanh. */
async function waitForReconcile(timeoutMs: number) {
  const startedAt = Date.now();
  let state = await reconcileState();
  while (state.depth > 0 && Date.now() - startedAt < timeoutMs) {
    await sleep(1_000);
    state = await reconcileState();
  }
  return { ...state, waitedMs: Date.now() - startedAt };
}

const bankStats = async () => (await (await fetch(`${BANK}/stats`)).json()) as BankStats;

interface Sample {
  startSecond: number;
  status: string;
  ms: number;
}

/** Đọc từng request từ --out json. Thời điểm của mẫu là lúc request kết thúc, nên lúc bắt đầu là time − value (nhật ký 08/02 điểm 4). */
async function readSamples(file: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (line.includes('"metric":"http_req_duration"') && line.includes('"type":"Point"')) {
      const { data } = JSON.parse(line) as { data: { time: string; value: number; tags: { status?: string } } };
      const startMs = new Date(data.time).getTime() - data.value;
      samples.push({ startSecond: Math.floor(startMs / 1_000), status: data.tags.status ?? '0', ms: data.value });
    }
  }
  return samples;
}

function summarize(samples: Sample[]) {
  const count = (status: string) => samples.filter((sample) => sample.status === status).length;
  return {
    total: samples.length,
    completed: count('200'),
    pending: count('202'),
    failed: samples.length - count('200') - count('202'),
    over5s: samples.filter((sample) => sample.ms > 5_000).length,
  };
}

/** Giây đầu tiên sau mốc mà từ đó về sau mọi cửa sổ 5 giây đều có ≥ 99 % request hoàn tất. */
function recoverySeconds(samples: Sample[], recoveredSecond: number): number | null {
  const last = Math.max(...samples.map((sample) => sample.startSecond));
  let recovered: number | null = null;
  for (let second = last - 4; second >= recoveredSecond; second -= 1) {
    const window = samples.filter((sample) => sample.startSecond >= second && sample.startSecond < second + 5);
    const done = window.filter((sample) => sample.status === '200').length;
    if (window.length === 0 || done / window.length < 0.99) {
      break;
    }
    recovered = second - recoveredSecond;
  }
  return recovered;
}

const median = (items: number[]) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)] ?? 0;

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

async function outageScenario() {
  await compose(['down', '-v']);
  await compose(['up', '-d', '--wait']);
  const load = k6('outage', Number(values.duration));
  // Tính mốc từ request đầu tiên tới đối tác, vì k6 khởi động chậm hơn script (nhật ký 07/03 điểm 3).
  while ((await bankStats()).transfers === 0) {
    await sleep(20);
  }
  const startedAt = Date.now();
  await sleep(startedAt + outageAt * 1_000 - Date.now());
  const outageStart = Math.floor(Date.now() / 1_000);
  // Toxic `timeout` 0 ms: dữ liệu bị giữ, kết nối không đóng, tới khi gỡ toxic. Đối tác treo chứ không từ chối.
  await toxiproxy('POST', '/proxies/bank/toxics', {
    name: 'partner_down',
    type: 'timeout',
    stream: 'upstream',
    attributes: { timeout: 0 },
  });
  await sleep(startedAt + (outageAt + outageSeconds) * 1_000 - Date.now());
  await toxiproxy('DELETE', '/proxies/bank/toxics/partner_down');
  const recoveredSecond = Math.floor(Date.now() / 1_000);
  await load;
  await sleep(2_000);
  const reconcile = await waitForReconcile(300_000);

  const stats = await bankStats();
  const offered = (second: number) => {
    const entry = stats.perSecond[String(second)];
    return entry ? entry.transfers + entry.lookups : 0;
  };
  const before = Array.from({ length: 30 }, (_, i) => offered(outageStart - 30 + i));
  const after = Array.from({ length: 10 }, (_, i) => offered(recoveredSecond + i));
  const baseline = median(before);
  const samples = await readSamples(join(outDir, `${variant}-outage.ndjson`));
  return {
    baselineRps: baseline,
    secondsAfterRecovery: after,
    peakRps: Math.max(...after),
    peakRatio: Math.max(...after) / baseline,
    rejectedAfterRecovery: Array.from({ length: 10 }, (_, i) => stats.perSecond[String(recoveredSecond + i)]?.rejected ?? 0),
    recoverySeconds: recoverySeconds(samples, recoveredSecond),
    requests: summarize(samples),
    reconcile,
    duplicates: stats.duplicates,
    bankTransfers: stats.transfers,
  };
}

async function flakyScenario() {
  await compose(['down', '-v']);
  await compose(['up', '-d', '--wait']);
  await fetch(`${BANK}/admin/behavior`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"errorRate":0.05}' });
  await k6('flaky', Number(values['flaky-seconds']));
  const samples = await readSamples(join(outDir, `${variant}-flaky.ndjson`));
  const requests = summarize(samples);
  return { requests, successRate: requests.completed / requests.total };
}

const outage = await outageScenario();
const flaky = await flakyScenario();
clearInterval(sleepWatch);
const power = await run('pmset', ['-g', 'batt']);
writeFileSync(
  join(outDir, `${variant}-meta.json`),
  JSON.stringify({ ...values, outage, flaky, loadEnd: loadavg(), power: power.split('\n')[0], sleepGaps }, null, 2),
);
await compose(['down', '-v']);
console.log(`Xong ${variant}; khoảng ngủ: ${sleepGaps.length}`);
