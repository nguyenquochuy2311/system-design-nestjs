/**
 * Bộ nhớ đỉnh và thời gian của MỘT lần xuất theo số dòng, không có tải nền: bản trước (web dựng workbook trong bộ nhớ)
 * so với bản sau (worker đọc cursor, ghi luồng lên S3-compatible). Mỗi lần đo bật tiến trình mới, khởi động nóng
 * bằng một lần xuất 100 dòng, rồi xuất SIZE dòng; RSS lấy bằng `ps` mỗi 100 ms từ tiến trình đo.
 *   RUN=main SIZES=10000,50000,200000 REPS=3 pnpm bench:memory   → bench/results/<RUN>/memory.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { round, sampleRss, startProcess, summarize, waitForLog, waitHttp } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const LOGS = join(OUT, 'memory-logs');
mkdirSync(LOGS, { recursive: true });
const SIZES = (process.env.SIZES ?? '10000,50000,200000').split(',').map(Number);
const REPS = Number(process.env.REPS ?? 3);
const PORT = '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const MONTH = '2026-09';
const db = createDb(loadConfig().databaseUrl, 3);

async function tenantWith(rows: number): Promise<{ tenantId: number; userId: number }> {
  const { id: tenantId } = await db.insertInto('tenants').values({ name: `bench-memory-${rows}` }).returning('id').executeTakeFirstOrThrow();
  const { id: userId } = await db.insertInto('users').values({ tenant_id: tenantId, name: 'Kế toán đo', role: 'accountant' }).returning('id').executeTakeFirstOrThrow();
  // cùng cách sinh dữ liệu với db/seed.sql
  await sql`
    INSERT INTO orders (tenant_id, code, store_name, customer_name, customer_phone, status, item_count, subtotal, discount, total, created_at)
    SELECT ${tenantId}, 'DH' || lpad(g::text, 8, '0'), 'Cửa hàng số ' || (1 + g % 40), 'Khách hàng ' || (1 + (g * 7919) % 20000),
           '09' || lpad(((g * 104729) % 100000000)::text, 8, '0'), (ARRAY['paid', 'paid', 'paid', 'shipped', 'cancelled'])[1 + g % 5],
           1 + g % 7, s.subtotal, CASE WHEN s.subtotal >= 1000000 THEN s.subtotal / 20 ELSE 0 END,
           s.subtotal - CASE WHEN s.subtotal >= 1000000 THEN s.subtotal / 20 ELSE 0 END,
           timestamptz '2026-09-01 00:00:00+07' + ((g - 1)::double precision / ${rows}) * interval '30 days'
    FROM generate_series(1::bigint, ${rows}::bigint) g
    CROSS JOIN LATERAL (SELECT (50000 + (g * 2654435761::bigint) % 3000000) AS subtotal) s`.execute(db);
  await sql`ANALYZE orders`.execute(db);
  return { tenantId, userId };
}

async function dropTenant(tenantId: number) {
  await sql`DELETE FROM export_jobs WHERE tenant_id = ${tenantId}`.execute(db);
  await sql`DELETE FROM orders WHERE tenant_id = ${tenantId}`.execute(db);
  await sql`DELETE FROM users WHERE tenant_id = ${tenantId}`.execute(db);
  await sql`DELETE FROM tenants WHERE id = ${tenantId}`.execute(db);
}

const getXlsx = async (userId: number) => {
  const res = await fetch(`${BASE}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(userId) } });
  if (res.status !== 200) throw new Error(`truoc trả ${res.status}`);
  return (await res.arrayBuffer()).byteLength;
};

async function runJob(userId: number): Promise<{ jobMs: number; bytes: number; rowCount: number }> {
  const post = await fetch(`${BASE}/exports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': String(userId) }, body: JSON.stringify({ month: MONTH }) });
  const { id } = (await post.json()) as { id: number };
  for (;;) {
    await sleep(100);
    const body = (await (await fetch(`${BASE}/exports/${id}`, { headers: { 'x-user-id': String(userId) } })).json()) as { status: string; downloadUrl?: string; rowCount?: number };
    if (body.status === 'failed') throw new Error(`job ${id} failed`);
    if (body.status === 'done') {
      const job = await db.selectFrom('export_jobs').select(['started_at', 'finished_at']).where('id', '=', id).executeTakeFirstOrThrow();
      const bytes = (await (await fetch(body.downloadUrl!)).arrayBuffer()).byteLength;
      return { jobMs: job.finished_at!.getTime() - job.started_at!.getTime(), bytes, rowCount: body.rowCount ?? 0 };
    }
  }
}

const warm = await tenantWith(100);
const results: Record<string, unknown>[] = [];
try {
  for (const size of SIZES) {
    const t = await tenantWith(size);
    for (let rep = 1; rep <= REPS; rep++) {
      // Bản trước: web process tự dựng file
      {
        const web = await startProcess('web', { PORT }, join(LOGS, `truoc-${size}-r${rep}-web.log`));
        try {
          await waitHttp(`${BASE}/health`);
          await getXlsx(warm.userId);
          await sleep(500);
          const rss = sampleRss({ web: web.pid }, 100);
          await sleep(500);
          const t0 = Date.now();
          const bytes = await getXlsx(t.userId);
          const ms = Date.now() - t0;
          await sleep(300);
          await rss.stop();
          const before = rss.samples.filter((s) => s.t < t0).map((s) => s.rssMb.web ?? 0);
          const r = { variant: 'truoc', size, rep, process: 'web', rssBeforeMb: Math.max(...before), rssPeakMb: rss.peak('web', t0), ms, bytes };
          results.push(r);
          console.log(JSON.stringify(r));
        } finally {
          await web.stop();
        }
      }
      // Bản sau: worker process ghi luồng; web chỉ nhận yêu cầu
      {
        const web = await startProcess('web', { PORT }, join(LOGS, `sau-${size}-r${rep}-web.log`));
        const logFile = join(LOGS, `sau-${size}-r${rep}-worker.log`);
        const worker = await startProcess('worker', { WORKER_POLL_MS: '50' }, logFile);
        try {
          await waitHttp(`${BASE}/health`);
          await waitForLog(() => readFileSync(logFile, 'utf8'), 'worker sẵn sàng');
          await runJob(warm.userId);
          await sleep(500);
          const rss = sampleRss({ web: web.pid, worker: worker.pid }, 100);
          await sleep(500);
          const t0 = Date.now();
          const job = await runJob(t.userId);
          await sleep(300);
          await rss.stop();
          const before = rss.samples.filter((s) => s.t < t0).map((s) => s.rssMb.worker ?? 0);
          const r = { variant: 'sau', size, rep, process: 'worker', rssBeforeMb: Math.max(...before), rssPeakMb: rss.peak('worker', t0), webRssPeakMb: rss.peak('web', t0), ms: job.jobMs, bytes: job.bytes, rowCount: job.rowCount };
          if (job.rowCount !== size) throw new Error(`job xuất ${job.rowCount} dòng, cần ${size}`);
          results.push(r);
          console.log(JSON.stringify(r));
        } finally {
          await worker.stop();
          await web.stop();
        }
      }
    }
    await dropTenant(t.tenantId);
  }
} finally {
  await dropTenant(warm.tenantId);
  await db.destroy();
}

const summary = SIZES.flatMap((size) =>
  ['truoc', 'sau'].map((variant) => {
    const rs = results.filter((r) => r.size === size && r.variant === variant) as { rssPeakMb: number; rssBeforeMb: number; ms: number; bytes: number }[];
    return {
      variant,
      size,
      rssPeakMb: summarize(rs.map((r) => r.rssPeakMb)),
      rssGrowthMb: summarize(rs.map((r) => round(r.rssPeakMb - r.rssBeforeMb))),
      ms: summarize(rs.map((r) => r.ms)),
      bytes: rs[0]?.bytes,
    };
  }),
);
writeFileSync(join(OUT, 'memory.json'), JSON.stringify({ env: { SIZES, REPS }, summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 1));
