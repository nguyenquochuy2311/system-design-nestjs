// Game day "chậm DB của checkout": toxic `latency` trên proxy checkout_db của Toxiproxy, trong lúc k6 tạo tải khách.
// Đo khách quan, không bấm giờ người thật:
//  - truoc: 3 service tắt instrumentation (OTEL_SDK_DISABLED=true), không có Collector/Prometheus/Grafana. Sau 60 s
//    kể từ lúc bật toxic ("khách than"), chạy một runbook CỐ ĐỊNH chỉ dùng log + docker stats, phân tích từng output
//    bằng luật viết sẵn bên dưới, đếm số bước tới khi khoanh đúng service và tài nguyên (hoặc không khoanh được).
//  - sau: bật instrumentation và cả bộ giám sát. Đo thời gian từ lúc bật toxic tới khi recording rule vượt ngưỡng và
//    alert chuyển pending/firing (đọc /api/v1/query, /api/v1/alerts), rồi chạy runbook PromQL cố định và ghi truy vấn
//    nào chỉ ra checkout + pool DB.
// Chạy: pnpm bench:game-day --mode truoc|sau [--rounds 3] [--latency 200] [--out main]
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { promAlerts, promQuery, toxiproxy } from '../test/support/stack.js';
import { compose, k6, servicesWithTelemetry } from './lib/compose.js';
import { dockerStats, machineState, median, run, sleep, startSleepDetector } from './lib/proc.js';

const { values: args } = parseArgs({
  options: {
    mode: { type: 'string', default: 'sau' },
    rounds: { type: 'string', default: '3' },
    latency: { type: 'string', default: '200' },
    out: { type: 'string', default: 'main' },
    baseline: { type: 'string', default: '60' },
    toxic: { type: 'string', default: '90' },
    recovery: { type: 'string', default: '60' },
  },
});
const MODE = args.mode as 'truoc' | 'sau';
const ROUNDS = Number(args.rounds);
const LATENCY_MS = Number(args.latency);
const OUT = `bench/results/${args.out}`;
const BASELINE_S = Number(args.baseline);
const TOXIC_S = Number(args.toxic);
const RECOVERY_S = Number(args.recovery);
const COMPLAINT_AFTER_S = 60; // bản trước: "khách than" 60 s sau sự cố thì người trực bắt đầu runbook
const P95_THRESHOLD = 0.5;
mkdirSync(OUT, { recursive: true });

const TOXIC = { name: 'gameday_latency', type: 'latency', stream: 'downstream', toxicity: 1, attributes: { latency: LATENCY_MS, jitter: 0 } };
const toxicOn = () => toxiproxy('POST', '/proxies/checkout_db/toxics', TOXIC);
const toxicOff = () => toxiproxy('DELETE', `/proxies/checkout_db/toxics/${TOXIC.name}`);

// ---------- Bản trước: runbook chỉ có log + docker stats ----------
const APP_CONTAINERS = ['gateway', 'checkout', 'promotion', 'postgres']; // Toxiproxy là công cụ tiêm lỗi, không thuộc hệ thống
const DB_WORDS = /pool|connect|ECONN|timeout exceeded|too many clients|database|postgres|terminat|query/i;

interface StepResult {
  step: number;
  command: string;
  evidence: string[];
  blamesService?: string;
  blamesResource?: string;
}

async function runbookTruoc(dir: string): Promise<{ steps: StepResult[]; serviceStep: number | null; service: string | null; resourceStep: number | null; resource: string | null }> {
  const steps: StepResult[] = [];
  let suspect: string | null = null;
  let serviceStep: number | null = null;
  let resource: string | null = null;
  let resourceStep: number | null = null;
  const commands: { command: string; exec: () => Promise<string>; analyse: (out: string) => Omit<StepResult, 'step' | 'command'> }[] = [
    {
      command: 'docker stats --no-stream',
      exec: async () => JSON.stringify(await dockerStats(), null, 2),
      analyse: (out) => {
        const stats = JSON.parse(out) as Record<string, { cpu: number; memMiB: number }>;
        const hot = APP_CONTAINERS.filter((c) => (stats[c]?.cpu ?? 0) > 80);
        return { evidence: APP_CONTAINERS.map((c) => `${c}: CPU ${stats[c]?.cpu}% RAM ${stats[c]?.memMiB} MiB`), blamesResource: hot.length ? `CPU của ${hot.join(', ')}` : undefined };
      },
    },
    ...['gateway', 'checkout', 'promotion', 'postgres'].map((svc) => ({
      command: `docker compose logs --since ${COMPLAINT_AFTER_S + 30}s ${svc}`,
      exec: async () => {
        const r = await run('docker', ['compose', 'logs', '--no-color', '--since', `${COMPLAINT_AFTER_S + 30}s`, svc]);
        return r.stdout + r.stderr;
      },
      analyse: (out: string) => {
        const errors = out.split('\n').filter((l) => /ERROR|FATAL|PANIC/.test(l));
        const others = ['gateway', 'checkout', 'promotion'].filter((s) => s !== svc);
        const named = others.filter((s) => errors.some((l) => l.includes(s)));
        const dbErrors = errors.filter((l) => DB_WORDS.test(l));
        return {
          evidence: [`${out.split('\n').filter(Boolean).length} dòng, ${errors.length} dòng ERROR`, ...errors.slice(0, 3).map((l) => l.slice(0, 200))],
          blamesService: named[0],
          blamesResource: svc !== 'gateway' && dbErrors.length ? `DB (log ${svc}: ${dbErrors[0]!.slice(0, 120)})` : undefined,
        };
      },
    })),
  ];
  for (const [i, c] of commands.entries()) {
    const out = await c.exec();
    writeFileSync(`${dir}/step-${i + 1}.txt`, `$ ${c.command}\n${out}`);
    const res = { step: i + 1, command: c.command, ...c.analyse(out) };
    steps.push(res);
    // Luật khoanh service: đi theo chuỗi "service A báo lỗi khi gọi B" cho tới service không đổ lỗi cho ai.
    if (res.blamesService && (suspect === null || res.command.endsWith(` ${suspect}`))) {
      suspect = res.blamesService;
      serviceStep = res.step;
    }
    if (res.blamesResource && resource === null) {
      resource = res.blamesResource;
      resourceStep = res.step;
    }
  }
  return { steps, serviceStep, service: suspect, resourceStep, resource };
}

// ---------- Bản sau: runbook PromQL cố định ----------
const Q = {
  symptoms: `service_name:http_server_request_duration_seconds:p95_1m > ${P95_THRESHOLD} or service_name:http_server_errors:ratio_rate1m > 0.05`,
  // Service có triệu chứng mà lời gọi ra ngoài của nó không chậm → nguyên nhân nằm trong chính service đó.
  origin: `service_name:http_server_request_duration_seconds:p95_1m > ${P95_THRESHOLD} unless on (service_name) (max by (service_name) (service_name_server_address:http_client_request_duration_seconds:p95_1m) > ${P95_THRESHOLD})`,
  poolUtilization: 'service_name:db_client_connection_utilization:ratio',
  poolPending: 'service_name:db_client_connection_pending_requests:max',
  poolWaitP95: 'service_name:db_client_connection_wait_time_seconds:p95_1m',
  dbOperationP95: 'service_name:db_client_operation_duration_seconds:p95_1m',
  eventLoopP99: 'service_name:nodejs_eventloop_delay_p99_seconds:max',
  cpuCores: 'service_name:process_cpu_time_seconds:rate1m',
  pgActive: 'postgres:pg_stat_activity_active:count',
  pgConnUtilization: 'postgres:pg_connections:utilization_ratio',
};

async function runbookSau() {
  const results: Record<string, Record<string, number>> = {};
  for (const [name, expr] of Object.entries(Q)) {
    const r = await promQuery(expr);
    results[name] = Object.fromEntries(r.map((s) => [s.metric.service_name ?? 'postgres', Number(Number(s.value[1]).toPrecision(4))]));
  }
  const origin = Object.keys(results.origin ?? {});
  const c = (k: string) => results[k]?.checkout ?? Number.NaN;
  // Luật khoanh tài nguyên trong service gốc (USE): pool dùng hết + có request chờ, event loop và CPU không nghẽn.
  const poolSaturated = c('poolUtilization') >= 1 && c('poolPending') > 0;
  const loopOk = c('eventLoopP99') < 0.1;
  const cpuOk = c('cpuCores') < 0.8;
  return {
    queries: Q,
    results,
    service: origin.length === 1 ? origin[0] : origin.join(',') || null,
    resource: poolSaturated && loopOk && cpuOk ? 'pool DB của checkout (pool đầy, request chờ kết nối; event loop, CPU bình thường)' : null,
  };
}

// ---------- Một vòng ----------
async function round(i: number) {
  const dir = `${OUT}/game-day-${MODE}-r${i}`;
  mkdirSync(dir, { recursive: true });
  const machine = await machineState();
  const sleepDetector = startSleepDetector();
  await toxicOff();
  const total = BASELINE_S + TOXIC_S + RECOVERY_S;
  const load = k6('game-day-load.k6.js', { DURATION: `${total}s` }, `${args.out}/game-day-${MODE}-r${i}/k6.json`);
  await sleep(BASELINE_S * 1000);

  const tOn = Date.now();
  await toxicOn();
  const record: Record<string, unknown> = { round: i, mode: MODE, latencyMs: LATENCY_MS, toxicOnAt: new Date(tOn).toISOString(), machine };

  if (MODE === 'truoc') {
    await sleep(COMPLAINT_AFTER_S * 1000);
    const t = Date.now();
    record.runbook = await runbookTruoc(dir);
    record.runbookSeconds = (Date.now() - t) / 1000;
    await sleep(Math.max(0, tOn + TOXIC_S * 1000 - Date.now()));
  } else {
    const firstSeen: Record<string, number> = {};
    const alertActiveAt: Record<string, string> = {};
    const mark = (k: string) => (firstSeen[k] ??= (Date.now() - tOn) / 1000);
    const polls: [number, number][] = []; // [giây từ lúc bật toxic, ms chờ API] để thấy độ phân giải của phép hỏi
    while (Date.now() < tOn + TOXIC_S * 1000) {
      const tq = Date.now();
      const [p95, alerts] = await Promise.all([promQuery('service_name:http_server_request_duration_seconds:p95_1m'), promAlerts()]);
      polls.push([Number(((tq - tOn) / 1000).toFixed(2)), Date.now() - tq]);
      for (const s of p95) if (Number(s.value[1]) > P95_THRESHOLD) mark(`rule p95>${P95_THRESHOLD}s{${s.metric.service_name}}`);
      for (const a of alerts) {
        const key = `${a.labels.alertname}{${a.labels.service_name}}`;
        mark(`${key} ${a.state}`);
        if (a.state === 'pending' || a.state === 'firing') mark(`${key} pending`);
        alertActiveAt[key] ??= a.activeAt;
      }
      if (firstSeen['DbPoolSaturated{checkout} firing'] !== undefined && firstSeen['RedLatencyP95High{checkout} firing'] !== undefined && !record.runbook) {
        record.runbookAtSeconds = (Date.now() - tOn) / 1000;
        record.runbook = await runbookSau();
      }
      await sleep(1000);
    }
    if (!record.runbook) {
      record.runbookAtSeconds = (Date.now() - tOn) / 1000;
      record.runbook = await runbookSau();
    }
    record.firstSeenSeconds = firstSeen;
    record.polls = polls;
    // activeAt là thời điểm rule đánh giá lần đầu thấy điều kiện đúng (chính xác hơn bước hỏi 1 s).
    record.alertActiveAfterSeconds = Object.fromEntries(
      Object.entries(alertActiveAt).map(([k, v]) => [k, Number(((Date.parse(v) - tOn) / 1000).toFixed(1))]),
    );
  }

  await toxicOff();
  record.toxicOffAt = new Date().toISOString();
  const k6Result = await load;
  record.k6ExitCode = k6Result.code;
  if (k6Result.code !== 0) record.k6Stderr = k6Result.stderr.slice(-1500);
  record.sleepGaps = sleepDetector.stop();
  record.machineAfter = await machineState();
  writeFileSync(`${dir}/result.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ round: i, ...summarize(record) }));
  // Chờ hệ thống về bình thường (không còn alert) trước vòng sau; tải đã dừng nên cửa sổ [1m] sẽ trống.
  if (MODE === 'sau') {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && (await promAlerts()).length > 0) await sleep(2000);
  }
  return record;
}

function summarize(r: Record<string, unknown>) {
  const rb = r.runbook as Record<string, unknown>;
  if (MODE === 'truoc') {
    return { serviceStep: rb.serviceStep, service: rb.service, resourceStep: rb.resourceStep, resource: rb.resource, steps: (rb.steps as unknown[]).length };
  }
  const fs = r.firstSeenSeconds as Record<string, number>;
  return {
    ruleP95Checkout: fs[`rule p95>${P95_THRESHOLD}s{checkout}`],
    latencyPendingCheckout: fs['RedLatencyP95High{checkout} pending'],
    latencyFiringCheckout: fs['RedLatencyP95High{checkout} firing'],
    poolFiringCheckout: fs['DbPoolSaturated{checkout} firing'],
    activeAt: r.alertActiveAfterSeconds,
    service: rb.service,
    resource: rb.resource,
  };
}

// ---------- Chạy ----------
console.log(`game day ${MODE}: ${ROUNDS} vòng, latency ${LATENCY_MS} ms, máy ${JSON.stringify(await machineState())}`);
if (MODE === 'truoc') {
  // Bản trước: không có bộ giám sát nào chạy; service tắt instrumentation.
  await compose(['stop', 'grafana', 'prometheus', 'postgres-exporter', 'otel-collector']);
  await servicesWithTelemetry(false, { noDeps: true });
} else {
  await compose(['up', '-d', '--wait'], { OTEL_SDK_DISABLED: 'false' });
  await servicesWithTelemetry(true);
}
const rounds: Record<string, unknown>[] = [];
for (let i = 1; i <= ROUNDS; i++) rounds.push(await round(i));

const summary: Record<string, unknown> = { mode: MODE, latencyMs: LATENCY_MS, rounds: rounds.map(summarize) };
if (MODE === 'sau') {
  const pick = (k: string) => rounds.map((r) => (r.firstSeenSeconds as Record<string, number>)[k]).filter((x): x is number => x !== undefined);
  for (const k of [`rule p95>${P95_THRESHOLD}s{checkout}`, 'RedLatencyP95High{checkout} pending', 'RedLatencyP95High{checkout} firing', 'DbPoolSaturated{checkout} pending', 'DbPoolSaturated{checkout} firing', 'RedErrorRatioHigh{checkout} firing', 'RedLatencyP95High{gateway} firing']) {
    const xs = pick(k);
    summary[`median ${k}`] = xs.length ? { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length } : null;
  }
} else {
  await compose(['up', '-d', '--wait'], { OTEL_SDK_DISABLED: 'false' });
}
writeFileSync(`${OUT}/game-day-${MODE}-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
