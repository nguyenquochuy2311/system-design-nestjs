// Một lượt đo: dựng N pod (docker compose --scale api=N), lấy mẫu kết nối thật trên PostgreSQL (mỗi 5 s),
// hàng đợi PgBouncer (mỗi 1 s), RAM/CPU container PostgreSQL (mỗi 5 s), chạy k6 (container, cùng mạng), rồi gom vào
// bench/results/<NAME>.run.json (+ <NAME>.k6.json của k6, <NAME>.api.log là log sự kiện của các pod).
// Cần: pnpm db:up && pnpm db:seed && pnpm build. Script tự dựng pod và tự gỡ pod sau lượt đo.
//
//   MODE=truoc PODS=40 NAME=truoc-40 pnpm bench:step          # VUS = 3 × PODS
//   MODE=sau   PODS=40 DURATION_S=600 NAME=sau-40-10m pnpm bench:step
//   MODE=truoc SCALE_STEPS=6,20,40 STEP_SECONDS=60 NAME=truoc-scale pnpm bench:step   # tăng tải theo bước, pod tăng
//     theo sau SCALE_DELAY_S=15 giây (như HPA phản ứng sau khi tải đã tăng)
//   MODE=sau PODS=6 VUS=60 RATE=1000 NAME=sau-6-r1000 pnpm bench:step   # tải mở: 1.000 request/giây cố định
// Biến khác: VUS_PER_POD=3 · WARMUP_S=10 · POOL_MAX · SAMPLE_MS=5000 · POOL_SAMPLE_MS=1000 · RESULTS_DIR=bench/results
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { ADMIN_URL, PGBOUNCER_ADMIN_URLS } from '../src/shared/config';

const run = promisify(execFile);
const MODE = process.env.MODE === 'truoc' ? 'truoc' : 'sau';
const SCALE_STEPS = (process.env.SCALE_STEPS ?? process.env.PODS ?? '6').split(',').map(Number);
const STEP_SECONDS = Number(process.env.STEP_SECONDS ?? 60);
const VUS_PER_POD = Number(process.env.VUS_PER_POD ?? 3);
const SCALE_DELAY_S = Number(process.env.SCALE_DELAY_S ?? 15);
// Lượt tăng bước: k6 đóng kết nối mỗi 20 lượt để tải lan sang pod mới (giữ kết nối mãi thì pod mới không nhận gì).
const CONN_CLOSE_EVERY = Number(process.env.CONN_CLOSE_EVERY ?? 20);
// Nghỉ trước mỗi lượt để CPU máy ảo hết bận việc của lượt trước (backend đang thoát, autovacuum...).
const COOLDOWN_S = Number(process.env.COOLDOWN_S ?? 15);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
// Tải mở (k6 constant-arrival-rate): RATE request/giây, VUS là số người dùng ảo tối đa (mặc định PODS × VUS_PER_POD).
const RATE = Number(process.env.RATE ?? 0);
const VUS = process.env.VUS ? Number(process.env.VUS) : undefined;
const WARMUP_S = Number(process.env.WARMUP_S ?? 10);
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 5000);
const POOL_SAMPLE_MS = Number(process.env.POOL_SAMPLE_MS ?? 1000);
const RESULTS_DIR = process.env.RESULTS_DIR ?? 'bench/results';
if (!RESULTS_DIR.startsWith('bench/')) throw new Error('RESULTS_DIR phải nằm dưới bench/ (k6 trong container chỉ thấy ./bench)');
const scaled = SCALE_STEPS.length > 1;
const NAME = process.env.NAME ?? `${MODE}-${SCALE_STEPS.join('-')}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

mkdirSync(RESULTS_DIR, { recursive: true });

interface PgSample {
  t: number;
  appTotal: number;
  appActive: number;
  appIdle: number;
  appIdleInTx: number;
  otherClients: number;
  autovacuumWorkers: number;
}
interface SysSample {
  t: number;
  pssMb: number;
  postgresProcesses: number;
  dockerMemMb: number;
  dockerCpuPct: number;
  vmLoad1: number; // load average 1 phút của máy ảo Docker (8 vCPU): đo mức tranh CPU giữa pod, k6 và DB
  vmCpuBusyPct: number; // % CPU máy ảo bận kể từ mẫu trước (/proc/stat)
  hostLoad1: number; // load average 1 phút của macOS (gồm cả ứng dụng khác của người dùng)
}
interface PoolSample {
  t: number;
  instance: number;
  clActive: number;
  clWaiting: number;
  svActive: number;
  svIdle: number;
  maxwaitMs: number;
}

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, application_name: 'bench-sampler' });
  await c.connect();
  return c;
}

/** PgBouncer: đóng mọi kết nối còn giữ từ lượt trước để lượt này bắt đầu từ 0 kết nối thật. */
async function resetPoolers(admins: pg.Client[]): Promise<void> {
  for (const a of admins) {
    for (const db of ['wallet', 'wallet_one']) {
      await a.query(`KILL ${db}`);
      await a.query(`RESUME ${db}`);
    }
  }
}

async function pgSample(admin: pg.Client): Promise<PgSample> {
  const { rows } = await admin.query(`
    SELECT count(*) FILTER (WHERE usename = 'wallet_app')::int AS app_total,
           count(*) FILTER (WHERE usename = 'wallet_app' AND state = 'active')::int AS app_active,
           count(*) FILTER (WHERE usename = 'wallet_app' AND state = 'idle')::int AS app_idle,
           count(*) FILTER (WHERE usename = 'wallet_app' AND state = 'idle in transaction')::int AS app_idle_in_tx,
           count(*) FILTER (WHERE backend_type = 'client backend' AND usename IS DISTINCT FROM 'wallet_app')::int AS other,
           count(*) FILTER (WHERE backend_type = 'autovacuum worker')::int AS autovacuum
    FROM pg_stat_activity WHERE backend_type IN ('client backend', 'autovacuum worker')`);
  const r = rows[0];
  return {
    t: Date.now(),
    appTotal: r.app_total,
    appActive: r.app_active,
    appIdle: r.app_idle,
    appIdleInTx: r.app_idle_in_tx,
    otherClients: r.other,
    autovacuumWorkers: r.autovacuum,
  };
}

/** Số transaction đã commit của database wallet (đối chiếu với số request thành công k6 đếm). */
async function committedTransactions(admin: pg.Client): Promise<number> {
  const { rows } = await admin.query("SELECT xact_commit::bigint AS n FROM pg_stat_database WHERE datname = 'wallet'");
  return Number(rows[0].n);
}

async function postgresContainerId(): Promise<string> {
  const { stdout } = await run('docker', ['compose', 'ps', '-q', 'postgres']);
  return stdout.trim();
}

let prevCpu: number[] | null = null;

/** Tổng PSS (bộ nhớ thật chia đều phần dùng chung) của mọi tiến trình postgres, `docker stats` của container,
 * và tải CPU của cả máy ảo Docker (container dùng chung kernel nên /proc/loadavg, /proc/stat là của máy ảo). */
async function sysSample(containerId: string): Promise<SysSample> {
  const pssScript =
    'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = postgres ] && awk \'/^Pss:/{print $2}\' $p/smaps_rollup 2>/dev/null; done | awk \'{s+=$1} END {print s, NR}\'';
  const [pss, stats, vm, host] = await Promise.all([
    // -u postgres: root trong container không có CAP_SYS_PTRACE nên không đọc được smaps của tiến trình khác user
    run('docker', ['exec', '-u', 'postgres', containerId, 'sh', '-c', pssScript]),
    run('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', containerId]),
    run('docker', ['exec', containerId, 'sh', '-c', 'cat /proc/loadavg; head -1 /proc/stat']),
    run('sysctl', ['-n', 'vm.loadavg']),
  ]);
  const [pssKb, procs] = pss.stdout.trim().split(/\s+/).map(Number);
  const [mem, cpu] = stats.stdout.trim().split('|');
  const [loadLine, cpuLine] = vm.stdout.trim().split('\n');
  const ticks = cpuLine!.trim().split(/\s+/).slice(1).map(Number); // user nice system idle iowait irq softirq steal
  let busyPct = NaN;
  if (prevCpu) {
    const d = ticks.map((v, i) => v - (prevCpu![i] ?? 0));
    const total = d.slice(0, 8).reduce((a, b) => a + b, 0);
    busyPct = total > 0 ? (100 * (total - d[3]! - d[4]!)) / total : NaN;
  }
  prevCpu = ticks;
  return {
    t: Date.now(),
    pssMb: (pssKb ?? 0) / 1024,
    postgresProcesses: procs ?? 0,
    dockerMemMb: toMb(mem!.split('/')[0]!.trim()),
    dockerCpuPct: parseFloat(cpu!),
    vmLoad1: Number(loadLine!.split(' ')[0]),
    vmCpuBusyPct: busyPct,
    hostLoad1: Number(host.stdout.replace(/[{}]/g, '').trim().split(/\s+/)[0]),
  };
}

function toMb(s: string): number {
  const n = parseFloat(s);
  if (s.endsWith('GiB')) return n * 1024;
  if (s.endsWith('KiB')) return n / 1024;
  return n; // MiB
}

async function poolSamples(admins: pg.Client[]): Promise<PoolSample[]> {
  const t = Date.now();
  const out: PoolSample[] = [];
  for (const [i, a] of admins.entries()) {
    const { rows } = await a.query('SHOW POOLS');
    for (const r of rows.filter((x) => x.database === 'wallet')) {
      out.push({
        t,
        instance: i,
        clActive: Number(r.cl_active),
        clWaiting: Number(r.cl_waiting),
        svActive: Number(r.sv_active),
        svIdle: Number(r.sv_idle),
        maxwaitMs: Number(r.maxwait) * 1000 + Number(r.maxwait_us) / 1000,
      });
    }
  }
  return out;
}

async function poolerStats(admins: pg.Client[]): Promise<{ xact: number; waitUs: number }> {
  let xact = 0;
  let waitUs = 0;
  for (const a of admins) {
    const { rows } = await a.query('SHOW STATS');
    const w = rows.find((r) => r.database === 'wallet');
    if (w) {
      xact += Number(w.total_xact_count);
      waitUs += Number(w.total_wait_time);
    }
  }
  return { xact, waitUs };
}

/** Lặp fn mỗi intervalMs cho tới khi stop() (lỗi lấy mẫu được ghi lại, không làm hỏng lượt đo). */
function every<T>(intervalMs: number, fn: () => Promise<T | T[]>, sink: T[], errors: string[]) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        const v = await fn();
        Array.isArray(v) ? sink.push(...v) : sink.push(v);
      } catch (err) {
        errors.push(`${new Date().toISOString()} ${(err as Error).message}`);
      }
      await sleep(Math.max(0, intervalMs - (Date.now() - started)));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
  };
}

async function compose(args: string[]): Promise<string> {
  const env = { ...process.env, MODE, POOL_MAX: process.env.POOL_MAX ?? '' };
  const { stdout } = await run('docker', ['compose', '--profile', 'pods', ...args], { env, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/** Số dòng sự kiện `event` trong log của mọi pod (kể cả pod đã khởi động lại). */
async function podEvents(sinceIso: string): Promise<{ ready: number; readinessFailed: number; failedKinds: Record<string, number>; lines: string[] }> {
  const out = await compose(['logs', '--no-color', '--no-log-prefix', '--since', sinceIso, 'api']);
  const lines = out.split('\n').filter((l) => l.startsWith('{'));
  const failedKinds: Record<string, number> = {};
  let ready = 0;
  let readinessFailed = 0;
  for (const l of lines) {
    const e = JSON.parse(l) as { event: string; kind?: string };
    if (e.event === 'ready') ready++;
    if (e.event === 'readiness_failed') {
      readinessFailed++;
      failedKinds[e.kind ?? 'other'] = (failedKinds[e.kind ?? 'other'] ?? 0) + 1;
    }
  }
  return { ready, readinessFailed, failedKinds, lines };
}

/** Gỡ pod của lượt trước, dựng N pod mới với MODE của lượt này, chờ đủ N pod báo "ready". */
async function startPods(n: number, sinceIso: string): Promise<void> {
  await compose(['rm', '-sf', 'api']);
  await compose(['up', '-d', '--scale', `api=${n}`, 'api']);
  const deadline = Date.now() + 120_000;
  while ((await podEvents(sinceIso)).ready < n) {
    if (Date.now() > deadline) throw new Error(`quá 120 s mà chưa đủ ${n} pod sẵn sàng`);
    await sleep(500);
  }
}

async function restartCount(): Promise<number> {
  const ids = (await compose(['ps', '-a', '-q', 'api'])).split('\n').filter(Boolean);
  if (!ids.length) return 0;
  const { stdout } = await run('docker', ['inspect', '--format', '{{.RestartCount}}', ...ids]);
  return stdout.split('\n').filter(Boolean).reduce((s, x) => s + Number(x), 0);
}

function runK6(): Promise<number> {
  // --log-output=none: bỏ cảnh báo từng request lỗi (lỗi vẫn được đếm theo loại trong summary).
  // RESULTS_DIR là đường dẫn tương đối dưới bench/, giống nhau ở host và trong container k6 (./bench gắn vào /bench).
  const args = ['compose', '--profile', 'bench', 'run', '--rm', 'k6', 'run', '--quiet', '--log-output=none'];
  args.push('-e', 'BASE_URL=http://api:3100', '-e', `NAME=${NAME}`, '-e', `WARMUP_S=${WARMUP_S}`, '-e', `RESULTS_DIR=${RESULTS_DIR}`);
  if (scaled) {
    args.push('-e', `STAGES=${SCALE_STEPS.map((p) => `${STEP_SECONDS}:${p * VUS_PER_POD}`).join(',')}`);
    args.push('-e', `CONN_CLOSE_EVERY=${CONN_CLOSE_EVERY}`);
  }
  else args.push('-e', `VUS=${VUS ?? SCALE_STEPS[0]! * VUS_PER_POD}`, '-e', `DURATION_S=${DURATION_S}`, '-e', `RATE=${RATE}`);
  args.push('/bench/transfer.k6.js');
  const k6 = spawn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  return new Promise((r) => k6.once('exit', (code) => r(code ?? 1)));
}

async function postgresRejections(sinceIso: string): Promise<Record<string, number>> {
  const { stdout, stderr } = await run('docker', ['compose', 'logs', '--no-color', '--since', sinceIso, 'postgres'], { maxBuffer: 256 * 1024 * 1024 });
  const text = stdout + stderr;
  const count = (needle: string) => text.split('\n').filter((l) => l.includes(needle)).length;
  return {
    tooManyClients: count('sorry, too many clients already'),
    reservedForSuperuser: count('remaining connection slots are reserved'),
  };
}

function stats(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return { min: s[0]!, med: s[Math.floor((s.length - 1) / 2)]!, max: s[s.length - 1]!, n: s.length };
}

async function main(): Promise<void> {
  const admin = await connect(ADMIN_URL); // superuser: vẫn đo được khi role ứng dụng đã làm DB đầy
  const poolAdmins = await Promise.all(PGBOUNCER_ADMIN_URLS.map(connect));
  const containerId = await postgresContainerId();
  // Ghi lại kích thước pool của từng instance (có thể đã đổi lúc chạy bằng SET default_pool_size trên console).
  const poolerDefaultPoolSize: number[] = [];
  for (const a of poolAdmins) {
    const { rows } = await a.query('SHOW CONFIG');
    poolerDefaultPoolSize.push(Number(rows.find((r) => r.key === 'default_pool_size').value));
  }
  await resetPoolers(poolAdmins);
  await sleep(COOLDOWN_S * 1000);

  const sinceIso = new Date(Date.now() - 1000).toISOString();
  await startPods(SCALE_STEPS[0]!, sinceIso);
  console.log(`[${NAME}] ${SCALE_STEPS[0]} pod ${MODE} đã sẵn sàng, chạy k6...`);
  // Lượt tăng bước: thêm pod đúng lúc k6 tăng tải (như HPA), không tạo lại pod đang chạy.
  const scaleTimers = SCALE_STEPS.slice(1).map((n, i) =>
    setTimeout(() => {
      compose(['up', '-d', '--no-recreate', '--scale', `api=${n}`, 'api']).catch((err) => console.error(`scale lỗi: ${(err as Error).message}`));
    }, (STEP_SECONDS * (i + 1) + SCALE_DELAY_S) * 1000),
  );

  const pgSamples: PgSample[] = [];
  const sysSamples: SysSample[] = [];
  const pools: PoolSample[] = [];
  const samplerErrors: string[] = [];
  const statsBefore = await poolerStats(poolAdmins);
  const commitsBefore = await committedTransactions(admin);
  const stops = [
    every(SAMPLE_MS, () => pgSample(admin), pgSamples, samplerErrors),
    every(SAMPLE_MS, () => sysSample(containerId), sysSamples, samplerErrors),
    every(POOL_SAMPLE_MS, () => poolSamples(poolAdmins), pools, samplerErrors),
  ];
  const k6Started = Date.now();
  const k6Code = await runK6();
  const k6Ended = Date.now();
  scaleTimers.forEach(clearTimeout);
  for (const stop of stops) await stop();
  const statsAfter = await poolerStats(poolAdmins);
  const commits = (await committedTransactions(admin)) - commitsBefore;

  const pods = await podEvents(sinceIso);
  const restarts = await restartCount();
  writeFileSync(`${RESULTS_DIR}/${NAME}.api.log`, pods.lines.join('\n') + '\n');
  await compose(['rm', '-sf', 'api']);
  const rejections = await postgresRejections(sinceIso);
  await Promise.all([admin.end(), ...poolAdmins.map((a) => a.end())]);

  // Chỉ lấy mẫu sau warm-up (lượt tĩnh) để so với số "main" của k6; lượt tăng bước lấy toàn bộ.
  const mainFrom = scaled ? k6Started : k6Started + WARMUP_S * 1000;
  const inMain = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= mainFrom && x.t <= k6Ended);
  const k6 = JSON.parse(readFileSync(`${RESULTS_DIR}/${NAME}.k6.json`, 'utf8'));
  const fleetSummary = { pods: SCALE_STEPS[SCALE_STEPS.length - 1], readyEvents: pods.ready, readinessFailed: pods.readinessFailed, failedKinds: pods.failedKinds, restarts };
  const xact = statsAfter.xact - statsBefore.xact;
  const result = {
    name: NAME,
    mode: MODE,
    scaleSteps: SCALE_STEPS,
    stepSeconds: scaled ? STEP_SECONDS : undefined,
    scaleDelayS: scaled ? SCALE_DELAY_S : undefined,
    connCloseEvery: scaled ? CONN_CLOSE_EVERY : 0,
    poolMax: process.env.POOL_MAX || (MODE === 'truoc' ? 20 : 10),
    poolerDefaultPoolSize,
    vusPerPod: VUS_PER_POD,
    vus: VUS ?? (scaled ? undefined : SCALE_STEPS[0]! * VUS_PER_POD),
    rate: RATE || undefined,
    durationS: scaled ? SCALE_STEPS.length * STEP_SECONDS : DURATION_S,
    warmupS: scaled ? 0 : WARMUP_S,
    k6ExitCode: k6Code,
    startedAt: new Date(k6Started).toISOString(),
    aggregates: {
      appConnections: stats(inMain(pgSamples).map((s) => s.appTotal)),
      appConnectionsActive: stats(inMain(pgSamples).map((s) => s.appActive)),
      postgresPssMb: stats(inMain(sysSamples).map((s) => s.pssMb)),
      postgresProcesses: stats(inMain(sysSamples).map((s) => s.postgresProcesses)),
      dockerMemMb: stats(inMain(sysSamples).map((s) => s.dockerMemMb)),
      dockerCpuPct: stats(inMain(sysSamples).map((s) => s.dockerCpuPct)),
      vmLoad1: stats(inMain(sysSamples).map((s) => s.vmLoad1)),
      vmCpuBusyPct: stats(inMain(sysSamples).map((s) => s.vmCpuBusyPct).filter((x) => !Number.isNaN(x))),
      hostLoad1: stats(inMain(sysSamples).map((s) => s.hostLoad1)),
      poolerMaxwaitMs: stats(inMain(pools).map((s) => s.maxwaitMs)),
      poolerClientsWaiting: stats(inMain(pools).map((s) => s.clWaiting)),
      poolerXact: xact,
      poolerAvgWaitMsPerXact: xact > 0 ? (statsAfter.waitUs - statsBefore.waitUs) / xact / 1000 : null,
      postgresRejections: rejections,
      postgresCommitsDuringK6: commits, // gồm cả câu SELECT lẻ (lấy mẫu, readiness): lớn hơn số chuyển khoản một chút
      autovacuumWorkers: stats(inMain(pgSamples).map((s) => s.autovacuumWorkers)),
    },
    fleet: fleetSummary,
    k6: k6.phases,
    samples: { pg: pgSamples, sys: sysSamples, pools },
    samplerErrors,
  };
  writeFileSync(`${RESULTS_DIR}/${NAME}.run.json`, JSON.stringify(result, null, 2));
  const a = result.aggregates;
  console.log(
    `[${NAME}] kết nối thật (main): ${JSON.stringify(a.appConnections)} · PSS ${JSON.stringify(a.postgresPssMb)} MB · ` +
      `maxwait ${JSON.stringify(a.poolerMaxwaitMs)} ms · PG từ chối ${JSON.stringify(rejections)} · ` +
      `pod ${JSON.stringify({ readinessFailed: fleetSummary.readinessFailed, restarts })}`,
  );
  if (samplerErrors.length) console.log(`[${NAME}] lỗi lấy mẫu: ${samplerErrors.length} (xem .run.json)`);
}

await main();
