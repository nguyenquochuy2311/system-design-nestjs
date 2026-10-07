/**
 * Kế toán bấm "Xuất" 5 lần liên tiếp (gửi cùng lúc) với cùng bộ lọc.
 *   truoc: mỗi lần bấm là một request dựng file đầy đủ trong web process.
 *   sau: đếm số job và số message PGMQ được tạo; worker không chạy để đếm trước khi job xong.
 *   pnpm db:seed && RUN=main CLICKS=5 pnpm bench:clicks   → bench/results/<RUN>/repeated-clicks.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { loadConfig } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { startProcess, waitHttp } from './lib';

const OUT = join('bench/results', process.env.RUN ?? 'main');
mkdirSync(OUT, { recursive: true });
const CLICKS = Number(process.env.CLICKS ?? 5);
const PORT = '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const MONTH = '2026-09';
const db = createDb(loadConfig().databaseUrl, 3);
const user = (await db.selectFrom('users').select('id').where('tenant_id', '=', 1).orderBy('id').executeTakeFirstOrThrow()).id;
await sql`DELETE FROM export_jobs`.execute(db);
await sql`SELECT pgmq.purge_queue('exports')`.execute(db);

const web = await startProcess('web', { PORT }, join(OUT, 'repeated-clicks-web.log'));
try {
  await waitHttp(`${BASE}/health`);
  const t0 = Date.now();
  const truoc = await Promise.all(
    Array.from({ length: CLICKS }, async () => {
      const res = await fetch(`${BASE}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(user) } });
      return { status: res.status, bytes: (await res.arrayBuffer()).byteLength, ms: Date.now() - t0 };
    }),
  );
  const sau = await Promise.all(
    Array.from({ length: CLICKS }, async () => {
      const res = await fetch(`${BASE}/exports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': String(user) }, body: JSON.stringify({ month: MONTH }) });
      return { status: res.status, ...((await res.json()) as { id: number; created: boolean }) };
    }),
  );
  const jobs = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM export_jobs WHERE requested_by = ${user}`.execute(db)).rows[0]?.n);
  const messages = Number((await sql<{ n: number }>`SELECT queue_length AS n FROM pgmq.metrics('exports')`.execute(db)).rows[0]?.n);
  const result = {
    clicks: CLICKS,
    truoc: { fullExportsServed: truoc.filter((r) => r.status === 200).length, responses: truoc },
    sau: { distinctJobIds: new Set(sau.map((r) => r.id)).size, createdTrue: sau.filter((r) => r.created).length, jobsInDb: jobs, messagesInQueue: messages, responses: sau },
  };
  writeFileSync(join(OUT, 'repeated-clicks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ truoc: result.truoc.fullExportsServed, sau: { ...result.sau, responses: undefined } }));
} finally {
  await web.stop();
  await sql`DELETE FROM export_jobs`.execute(db);
  await sql`SELECT pgmq.purge_queue('exports')`.execute(db);
  await db.destroy();
}
