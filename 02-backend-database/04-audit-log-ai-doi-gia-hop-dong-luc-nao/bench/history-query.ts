// Thời gian trả lời "ai đổi phí hợp đồng X": EXPLAIN (ANALYZE, BUFFERS) đúng câu SQL mà API dùng
// (fieldHistoryQuery), trên nhật ký đã có sẵn (chạy sau bench/audit-storage.ts).
//   index   : kế hoạch mặc định, dùng audit_log_row_idx (table_name, row_id, changed_at); 2 lượt, lượt 2 là "ấm"
//   seqscan : tắt index scan / bitmap scan trong phiên để thấy cái giá nếu thiếu index
//   http    : GET /contracts/:id/history qua route Fastify (app.inject, không qua mạng)
// Ví dụ: RESULTS_DIR=bench/results/main SAMPLES=50 pnpm bench:history
import { buildApp } from '../src/app';
import { createDb } from '../src/shared/db';
import { fieldHistoryQuery } from '../src/sau/audit-query';
import { adminClient, median, quantile, round, save } from './lib';

const SAMPLES = Number(process.env.SAMPLES ?? 50);
const SEQ_SAMPLES = Number(process.env.SEQ_SAMPLES ?? 10);

interface Plan {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: Plan[];
  'Shared Hit Blocks': number;
  'Shared Read Blocks': number;
}
const nodes = (p: Plan): Plan[] => [p, ...(p.Plans ?? []).flatMap(nodes)];

const db = createDb();
const admin = await adminClient();
const app = buildApp(db);

// Hợp đồng mẫu trải đều trên dải id của seed (cố định, chạy lại cho cùng tập).
const ids = Array.from({ length: SAMPLES }, (_, i) => 1 + Math.floor(((i + 0.5) * 40000) / SAMPLES));

async function explain(id: number) {
  const q = fieldHistoryQuery(db, 'contracts', id, 'premium').compile();
  const { rows } = await admin.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, q.parameters as unknown[]);
  const top = rows[0]['QUERY PLAN'][0];
  const all = nodes(top.Plan as Plan);
  return {
    id,
    executionMs: top['Execution Time'] as number,
    planningMs: top['Planning Time'] as number,
    rows: (top.Plan as { 'Actual Rows': number })['Actual Rows'],
    sharedHit: (top.Plan as Plan)['Shared Hit Blocks'],
    sharedRead: (top.Plan as Plan)['Shared Read Blocks'],
    nodes: [...new Set(all.map((n) => n['Node Type'] + (n['Index Name'] ? `:${n['Index Name']}` : '')))],
  };
}

function stats(xs: number[]) {
  return { median: round(median(xs), 3), p95: round(quantile(xs, 0.95), 3), min: round(Math.min(...xs), 3), max: round(Math.max(...xs), 3) };
}

const result: Record<string, unknown> = {};
try {
  const { rows: [info] } = await admin.query(
    "SELECT count(*)::int AS rows, pg_size_pretty(pg_total_relation_size('audit.audit_log')) AS size, current_setting('shared_buffers') AS shared_buffers FROM audit.audit_log",
  );
  result.auditLog = info;
  console.log('Nhật ký:', info);

  const pass1 = [];
  for (const id of ids) pass1.push(await explain(id));
  const pass2 = [];
  for (const id of ids) pass2.push(await explain(id));
  result.index = {
    pass1: stats(pass1.map((p) => p.executionMs)),
    pass2: stats(pass2.map((p) => p.executionMs)),
    planningPass2: stats(pass2.map((p) => p.planningMs)),
    rowsPerAnswer: stats(pass2.map((p) => p.rows)),
    buffersPass2: stats(pass2.map((p) => p.sharedHit + p.sharedRead)),
    nodeTypes: [...new Set(pass2.flatMap((p) => p.nodes))],
    samples: pass2,
  };
  console.log('index lượt 1:', (result.index as { pass1: unknown }).pass1, 'lượt 2:', (result.index as { pass2: unknown }).pass2);

  await admin.query('SET enable_indexscan = off');
  await admin.query('SET enable_bitmapscan = off');
  const seq = [];
  for (const id of ids.slice(0, SEQ_SAMPLES)) seq.push(await explain(id));
  await admin.query('RESET enable_indexscan');
  await admin.query('RESET enable_bitmapscan');
  result.seqscan = {
    execution: stats(seq.map((p) => p.executionMs)),
    buffers: stats(seq.map((p) => p.sharedHit + p.sharedRead)),
    nodeTypes: [...new Set(seq.flatMap((p) => p.nodes))],
    samples: seq,
  };
  console.log('seqscan:', (result.seqscan as { execution: unknown }).execution);

  const http: number[] = [];
  for (const id of ids.slice(0, 10)) await app.inject({ method: 'GET', url: `/contracts/${id}/history?field=premium` }); // warm-up JIT, không tính
  for (const id of ids) {
    const t0 = performance.now();
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}/history?field=premium` });
    http.push(performance.now() - t0);
    if (res.statusCode !== 200) throw new Error(`GET history ${id}: ${res.statusCode}`);
  }
  result.http = stats(http);
  console.log('http (inject):', result.http);
} finally {
  await app.close();
  await db.destroy();
  await admin.end();
}
console.log('Đã ghi', save('history.json', result));
