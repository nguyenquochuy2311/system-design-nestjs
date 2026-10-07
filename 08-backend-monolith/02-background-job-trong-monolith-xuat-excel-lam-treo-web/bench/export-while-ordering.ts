/**
 * Kịch bản chính của bài: nhân viên cửa hàng tạo đơn đều đặn (k6, RATE đơn/giây) trong khi EXPORTS kế toán cùng xuất
 * báo cáo 50.000 dòng. Ba biến thể, mỗi lượt bật tiến trình mới:
 *   baseline: không ai xuất;  truoc: GET /truoc/reports/orders.xlsx (xuất trong request);
 *   sau: POST /exports → 202, worker riêng xuất theo luồng lên S3-compatible, client hỏi trạng thái rồi tải bằng presigned URL.
 * ROUNDS vòng, thứ tự biến thể xoay giữa các vòng. Số liệu trong "cửa sổ export" (từ lúc bấm xuất tới lúc file cuối xong):
 * độ trễ POST /orders (tính lại từ từng request trong --out json của k6), health check lỗi, event loop delay của web
 * (perf_hooks.monitorEventLoopDelay), RSS đỉnh của web và worker (ps mỗi 200 ms), thời gian hoàn tất từng export.
 *   pnpm db:seed && RUN=main ROUNDS=3 pnpm bench:load   → bench/results/<RUN>/load/
 */
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { percentile, round, sampleRss, startProcess, summarize, waitForLog, waitHttp, type Proc } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main', 'load');
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const RATE = Number(process.env.RATE ?? 50);
const DURATION_S = Number(process.env.DURATION_S ?? 50);
const EXPORT_AT_S = Number(process.env.EXPORT_AT_S ?? 10);
const BASELINE_WINDOW_S = Number(process.env.BASELINE_WINDOW_S ?? 30);
const EXPORTS = Number(process.env.EXPORTS ?? 5);
const WORKERS = Number(process.env.WORKERS ?? 1);
const WORKER_CONCURRENCY = process.env.WORKER_CONCURRENCY ?? '1';
const LB_TIMEOUT_MS = 60_000; // client hủy sau 60 giây như timeout của load balancer → tính là 504
const VARIANTS = (process.env.VARIANTS ?? 'baseline,truoc,sau').split(',');
const PORT = '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const MONTH = '2026-09';
mkdirSync(OUT, { recursive: true });

const db = createDb(loadConfig().databaseUrl, 3);
const accountants = (await db.selectFrom('users').select('id').where('tenant_id', '=', 1).where('role', '=', 'accountant').orderBy('id').execute()).map((u) => u.id);
const rows = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM orders WHERE tenant_id = 1`.execute(db)).rows[0]?.n);
if (accountants.length < EXPORTS || rows === 0) throw new Error('Chưa có dữ liệu đo: chạy pnpm db:seed trước');

/** % CPU bận của máy ảo Docker giữa hai lần đọc /proc/stat (nhật ký quyết định, bài 02/03). */
const vmCpu = () => {
  const line = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'head', '-1', '/proc/stat'], { encoding: 'utf8' });
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  return { idle: (n[3] ?? 0) + (n[4] ?? 0), total: n.reduce((a, b) => a + b, 0) };
};

interface ExportResult {
  user: number;
  startedAt: number;
  acceptedMs?: number; // sau: thời gian POST /exports trả 202
  endedAt: number; // truoc: lúc nhận xong file; sau: lúc client thấy done và tải xong file
  status: string; // 200 | 504 (hết 60 s) | lỗi
  bytes: number;
  jobMs?: number; // sau: finished_at − created_at trong DB
}

async function exportTruoc(user: number): Promise<ExportResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(user) }, signal: AbortSignal.timeout(LB_TIMEOUT_MS) });
    const bytes = (await res.arrayBuffer()).byteLength;
    return { user, startedAt, endedAt: Date.now(), status: String(res.status), bytes };
  } catch (err) {
    const status = (err as Error).name === 'TimeoutError' ? '504' : `lỗi: ${(err as Error).message}`;
    return { user, startedAt, endedAt: Date.now(), status, bytes: 0 };
  }
}

async function exportSau(user: number): Promise<ExportResult> {
  const startedAt = Date.now();
  const post = await fetch(`${BASE}/exports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': String(user) }, body: JSON.stringify({ month: MONTH }) });
  const acceptedMs = Date.now() - startedAt;
  const location = post.headers.get('location');
  if (post.status !== 202 || !location) return { user, startedAt, acceptedMs, endedAt: Date.now(), status: `POST ${post.status}`, bytes: 0 };
  const { id } = (await post.json()) as { id: number };
  for (;;) {
    await sleep(250); // hỏi dày hơn Retry-After (2 s) để đo thời gian hoàn tất chính xác hơn
    const res = await fetch(`${BASE}${location}`, { headers: { 'x-user-id': String(user) } });
    const body = (await res.json()) as { status: string; downloadUrl?: string };
    if (body.status === 'done' && body.downloadUrl) {
      const file = await fetch(body.downloadUrl); // tải thẳng từ S3-compatible, không qua web
      const bytes = (await file.arrayBuffer()).byteLength;
      const job = await db.selectFrom('export_jobs').select(['created_at', 'finished_at']).where('id', '=', id).executeTakeFirstOrThrow();
      return { user, startedAt, acceptedMs, endedAt: Date.now(), status: String(file.status), bytes, jobMs: job.finished_at!.getTime() - job.created_at.getTime() };
    }
    if (body.status === 'failed') return { user, startedAt, acceptedMs, endedAt: Date.now(), status: 'failed', bytes: 0 };
    if (Date.now() - startedAt > 10 * 60_000) return { user, startedAt, acceptedMs, endedAt: Date.now(), status: 'quá 10 phút', bytes: 0 };
  }
}

/** Đọc --out json của k6 theo dòng; giữ thời điểm bắt đầu (time − duration) và trạng thái của từng request. */
async function readK6(file: string) {
  const reqs: { name: string; start: number; ms: number; status: string; errorCode?: string }[] = [];
  const rl = createInterface({ input: createReadStream(file) });
  for await (const line of rl) {
    if (!line.includes('"http_req_duration"') || !line.includes('"Point"')) continue;
    const { data } = JSON.parse(line) as { data: { time: string; value: number; tags: { name: string; status: string; error_code?: string } } };
    // thời điểm trong JSON của k6 là lúc request kết thúc; lúc bắt đầu = time − duration (đã kiểm bằng server chờ 2 s)
    reqs.push({ name: data.tags.name, start: Date.parse(data.time) - data.value, ms: data.value, status: data.tags.status, errorCode: data.tags.error_code });
  }
  return reqs;
}

function windowStats(reqs: Awaited<ReturnType<typeof readK6>>, name: string, okStatus: string, from: number, to: number) {
  const inWin = reqs.filter((r) => r.name === name && r.start >= from && r.start <= to);
  // độ trễ tính trên request thành công; request lỗi (timeout, reset) đếm riêng theo mã lỗi của k6
  const ms = inWin.filter((r) => r.status === okStatus).map((r) => r.ms);
  const failed = inWin.filter((r) => r.status !== okStatus);
  const failedBy: Record<string, number> = {};
  for (const r of failed) failedBy[`${r.status}/${r.errorCode ?? '-'}`] = (failedBy[`${r.status}/${r.errorCode ?? '-'}`] ?? 0) + 1;
  let streak = 0;
  let maxStreak = 0;
  for (const r of [...inWin].sort((a, b) => a.start - b.start)) {
    streak = r.status === okStatus ? 0 : streak + 1;
    maxStreak = Math.max(maxStreak, streak);
  }
  return {
    count: inWin.length,
    failed: failed.length,
    failedBy,
    maxConsecutiveFailed: maxStreak,
    p50: round(percentile(ms, 50), 2),
    p95: round(percentile(ms, 95), 2),
    p99: round(percentile(ms, 99), 2),
    max: round(Math.max(...ms), 2),
    over1s: inWin.filter((r) => r.status === okStatus && r.ms > 1000).length,
  };
}

async function runOnce(variant: string, round_: number) {
  const tag = `${variant}-r${round_}`;
  await sql`DELETE FROM orders WHERE tenant_id = 2`.execute(db);
  await sql`DELETE FROM export_jobs`.execute(db);
  await sql`SELECT pgmq.purge_queue('exports')`.execute(db);

  const procs: Proc[] = [];
  const pids: Record<string, number> = {};
  const web = await startProcess('web', { PORT }, join(OUT, `${tag}-web.log`));
  procs.push(web);
  pids.web = web.pid;
  const workerLogs: string[] = [];
  if (variant === 'sau') {
    for (let i = 0; i < WORKERS; i++) {
      const logFile = join(OUT, `${tag}-worker${i + 1}.log`);
      const w = await startProcess('worker', { WORKER_CONCURRENCY, WORKER_POLL_MS: '200' }, logFile);
      procs.push(w);
      pids[`worker${i + 1}`] = w.pid;
      workerLogs.push(logFile);
    }
  }
  try {
    await waitHttp(`${BASE}/health`);
    for (const f of workerLogs) await waitForLog(() => readFileSync(f, 'utf8'), 'worker sẵn sàng');
    // khởi động nóng: một lần xuất trước khi đo để không tính thời gian JIT/nạp module lần đầu
    if (variant === 'truoc') await exportTruoc(accountants[0]!);
    if (variant === 'sau') await exportSau(accountants[0]!);
    await sql`DELETE FROM export_jobs`.execute(db);

    const rss = sampleRss(pids);
    const load1 = round(loadavg()[0] ?? 0, 2);
    const cpu0 = vmCpu();
    const k6File = join(OUT, `${tag}-k6.json`);
    const k6Start = Date.now();
    const k6 = spawn('k6', ['run', '--quiet', '--out', `json=${k6File}`, '--summary-export', join(OUT, `${tag}-k6-summary.json`),
      '-e', `BASE_URL=${BASE}`, '-e', `RATE=${RATE}`, '-e', `DURATION=${DURATION_S}s`, 'bench/export-while-ordering.k6.js'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let k6Err = '';
    k6.stderr.on('data', (d) => (k6Err += d));
    const k6Done = new Promise<number>((r) => k6.once('exit', (code) => r(code ?? -1)));

    await sleep(k6Start + EXPORT_AT_S * 1000 - Date.now());
    await fetch(`${BASE}/internal/runtime?reset=1`);
    const winStart = Date.now();
    let exports: ExportResult[] = [];
    if (variant === 'baseline') await sleep(BASELINE_WINDOW_S * 1000);
    else exports = await Promise.all(accountants.slice(0, EXPORTS).map((u) => (variant === 'truoc' ? exportTruoc(u) : exportSau(u))));
    const winEnd = Date.now();
    const runtime = (await (await fetch(`${BASE}/internal/runtime`)).json()) as Record<string, unknown>;

    const code = await k6Done;
    const cpu1 = vmCpu();
    await rss.stop();
    if (code !== 0) throw new Error(`k6 lỗi (${tag}): ${k6Err}`);
    const k6End = Date.now();

    const reqs = await readK6(k6File);
    const summary = JSON.parse(readFileSync(join(OUT, `${tag}-k6-summary.json`), 'utf8')).metrics;
    const result = {
      variant,
      round: round_,
      window: { seconds: round((winEnd - winStart) / 1000, 2), endedBeforeK6: winEnd < k6End },
      orders: windowStats(reqs, 'POST /orders', '201', winStart, winEnd),
      ordersOutsideWindow: windowStats(reqs, 'POST /orders', '201', k6Start + 5000, winStart),
      health: windowStats(reqs, 'GET /health', '200', winStart, winEnd),
      droppedIterations: summary.dropped_iterations?.count ?? 0,
      webEventLoop: runtime.eventLoopDelayMs,
      webHeapUsedMbAtEnd: (runtime.memoryMb as { heapUsed: number }).heapUsed,
      rssPeakMb: Object.fromEntries(Object.keys(pids).map((name) => [name, rss.peak(name, winStart, winEnd + 1000)])),
      rssBeforeMb: rss.samples[0]?.rssMb,
      exports: exports.map((e) => ({ ...e, totalMs: e.endedAt - e.startedAt })),
      exportsDone: exports.filter((e) => e.status === '200').length,
      exports504: exports.filter((e) => e.status === '504').length,
      lastExportMs: exports.length ? Math.max(...exports.map((e) => e.endedAt - winStart)) : null,
      load1Before: load1,
      dockerVmCpuBusyPct: round((1 - (cpu1.idle - cpu0.idle) / (cpu1.total - cpu0.total)) * 100, 1),
    };
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ ...result, rssSamples: rss.samples }, null, 2));
    console.log(JSON.stringify({ tag, window: result.window, orders: result.orders, health: result.health, el: result.webEventLoop, rss: result.rssPeakMb, last: result.lastExportMs, done: result.exportsDone }));
    return result;
  } finally {
    for (const p of procs.reverse()) await p.stop();
  }
}

const results: Awaited<ReturnType<typeof runOnce>>[] = [];
try {
  for (let r = 1; r <= ROUNDS; r++) {
    const order = VARIANTS.map((_, i) => VARIANTS[(i + r - 1) % VARIANTS.length]!);
    for (const v of order) results.push(await runOnce(v, r));
  }
} finally {
  await db.destroy();
}

const pick = (v: string, f: (r: (typeof results)[number]) => number) => summarize(results.filter((r) => r.variant === v).map(f));
const summary = Object.fromEntries(
  VARIANTS.map((v) => [
    v,
    {
      ordersCount: pick(v, (r) => r.orders.count),
      ordersP50: pick(v, (r) => r.orders.p50),
      ordersP95: pick(v, (r) => r.orders.p95),
      ordersP99: pick(v, (r) => r.orders.p99),
      ordersMax: pick(v, (r) => r.orders.max),
      ordersFailed: pick(v, (r) => r.orders.failed),
      ordersOver1s: pick(v, (r) => r.orders.over1s),
      healthFailed: pick(v, (r) => r.health.failed),
      healthMaxConsecutiveFailed: pick(v, (r) => r.health.maxConsecutiveFailed),
      eventLoopP99: pick(v, (r) => (r.webEventLoop as { p99: number }).p99),
      eventLoopMax: pick(v, (r) => (r.webEventLoop as { max: number }).max),
      webRssPeak: pick(v, (r) => r.rssPeakMb.web ?? 0),
      workerRssPeak: pick(v, (r) => r.rssPeakMb.worker1 ?? 0),
      windowSeconds: pick(v, (r) => r.window.seconds),
      lastExportMs: pick(v, (r) => r.lastExportMs ?? 0),
    },
  ]),
);
const env = { ROUNDS, RATE, DURATION_S, EXPORT_AT_S, BASELINE_WINDOW_S, EXPORTS, WORKERS, WORKER_CONCURRENCY, rows };
writeFileSync(join(OUT, '..', 'load-summary.json'), JSON.stringify({ env, summary, results }, null, 2));
console.log(JSON.stringify({ env, summary }, null, 1));
