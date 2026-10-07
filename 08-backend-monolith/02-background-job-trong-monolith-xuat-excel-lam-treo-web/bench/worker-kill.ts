/**
 * Diễn tập "tiến trình chết giữa lúc xuất 50.000 dòng" (SIGKILL, như `docker kill` hay OOM):
 *   truoc: kill web process khi request xuất đang chạy → client nhận lỗi, file mất, phải tự bấm lại.
 *   sau: kill worker khi đã ghi khoảng nửa số dòng, bật worker mới ngay → message hiện lại sau visibility timeout,
 *        worker mới làm lại từ đầu, file đủ dòng.
 *   pnpm db:seed && RUN=main TRIALS=5 VT=10 pnpm bench:kill   → bench/results/<RUN>/worker-kill.json
 */
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { startProcess, summarize, waitForLog, waitHttp, type Proc } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const LOGS = join(OUT, 'kill-logs');
mkdirSync(LOGS, { recursive: true });
const TRIALS = Number(process.env.TRIALS ?? 5);
const VT = process.env.VT ?? '10';
const PORT = '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const MONTH = '2026-09';
const db = createDb(loadConfig().databaseUrl, 3);
const users = (await db.selectFrom('users').select('id').where('tenant_id', '=', 1).where('role', '=', 'accountant').orderBy('id').execute()).map((u) => u.id);
const ROWS = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM orders WHERE tenant_id = 1`.execute(db)).rows[0]?.n);

async function startWorker(tag: string): Promise<Proc> {
  const logFile = join(LOGS, `${tag}.log`);
  const w = await startProcess('worker', { EXPORT_VT_SECONDS: VT, WORKER_POLL_MS: '100' }, logFile);
  await waitForLog(() => readFileSync(logFile, 'utf8'), 'worker sẵn sàng');
  return w;
}

const countRows = async (buf: ArrayBuffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0]!.rowCount - 1; // trừ dòng tiêu đề
};

const truoc: Record<string, unknown>[] = [];
const sau: Record<string, unknown>[] = [];
await sql`DELETE FROM export_jobs`.execute(db);
await sql`SELECT pgmq.purge_queue('exports')`.execute(db);

// --- Bản trước: kill web giữa lúc đang xuất trong request ---
let web = await startProcess('web', { PORT }, join(LOGS, 'truoc-web-0.log'));
await waitHttp(`${BASE}/health`);
const t0 = Date.now();
await (await fetch(`${BASE}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(users[0]) } })).arrayBuffer();
const fullMs = Date.now() - t0; // một lần xuất đầy đủ, để kill ở khoảng giữa
for (let i = 1; i <= TRIALS; i++) {
  const started = Date.now();
  const req = fetch(`${BASE}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(users[0]) } })
    .then(async (r) => `${r.status} ${(await r.arrayBuffer()).byteLength} byte`)
    .catch((err: Error) => `lỗi: ${err.message}${err.cause ? ` (${(err.cause as Error).message})` : ''}`);
  await sleep(Math.round(fullMs / 2));
  await web.stop('SIGKILL');
  const outcome = await req;
  truoc.push({ trial: i, killedAfterMs: Date.now() - started, outcome, completed: outcome.startsWith('200') });
  console.log('truoc', JSON.stringify(truoc.at(-1)));
  web = await startProcess('web', { PORT }, join(LOGS, `truoc-web-${i}.log`)); // như orchestrator bật lại instance
  await waitHttp(`${BASE}/health`);
}

// --- Bản sau: kill worker khi đã ghi khoảng nửa số dòng ---
for (let i = 1; i <= TRIALS; i++) {
  const user = users[i % users.length]!;
  const a = await startWorker(`sau-worker-a-${i}`);
  const post = await fetch(`${BASE}/exports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': String(user) }, body: JSON.stringify({ month: MONTH }) });
  const { id } = (await post.json()) as { id: number };
  let rowsAtKill = 0;
  for (;;) {
    const job = await db.selectFrom('export_jobs').select(['rows_written', 'status']).where('id', '=', id).executeTakeFirstOrThrow();
    if (job.status === 'done') throw new Error(`job ${id} xong trước khi kill; tăng ROWS hoặc giảm ngưỡng`);
    if (job.rows_written >= ROWS / 2) {
      rowsAtKill = job.rows_written;
      break;
    }
    await sleep(10);
  }
  await a.stop('SIGKILL');
  const killedAt = Date.now();
  const b = await startWorker(`sau-worker-b-${i}`);
  let job;
  for (;;) {
    job = await db.selectFrom('export_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    if (job.status === 'done' || job.status === 'failed') break;
    if (Date.now() - killedAt > 5 * 60_000) throw new Error(`job ${id} chưa xong sau 5 phút`);
    await sleep(100);
  }
  const doneAt = Date.now();
  const status = (await (await fetch(`${BASE}/exports/${id}`, { headers: { 'x-user-id': String(user) } })).json()) as { downloadUrl?: string };
  const fileRows = status.downloadUrl ? await countRows(await (await fetch(status.downloadUrl)).arrayBuffer()) : 0;
  await b.stop();
  sau.push({ trial: i, jobId: id, rowsAtKill, status: job.status, attempts: job.attempts, rowCount: job.row_count, fileRows, killToDoneMs: doneAt - killedAt, completed: job.status === 'done' && fileRows === ROWS });
  console.log('sau', JSON.stringify(sau.at(-1)));
}
await web.stop();
const queue = (await sql<{ queue_length: number }>`SELECT queue_length FROM pgmq.metrics('exports')`.execute(db)).rows[0]?.queue_length;
await db.destroy();

const result = {
  env: { TRIALS, VT: Number(VT), ROWS, fullExportMsTruoc: fullMs },
  truoc: { completed: truoc.filter((t) => t.completed).length, trials: truoc },
  sau: {
    completed: sau.filter((t) => t.completed).length,
    killToDoneMs: summarize(sau.map((t) => t.killToDoneMs as number)),
    queueLengthAfter: Number(queue),
    trials: sau,
  },
};
writeFileSync(join(OUT, 'worker-kill.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ env: result.env, truoc: result.truoc.completed, sau: result.sau.completed, killToDone: result.sau.killToDoneMs }));
