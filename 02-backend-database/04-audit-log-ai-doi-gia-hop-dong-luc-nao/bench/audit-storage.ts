// Dung lượng bảng nhật ký theo số thay đổi, và chi phí trigger khi một script sửa hàng loạt.
// Mỗi "đợt" sửa phí của TOÀN BỘ 40.000 hợp đồng = 40.000 thay đổi đi qua trigger thật, chia lô 1.000 hợp đồng,
// mỗi lô một transaction với một nhân viên khác nhau (set_config như withActor).
//   Pha 1 (diff): trigger chỉ lưu trường đã đổi, DIFF_ROUNDS đợt.
//   Pha 2 (full): trigger lưu cả bản cũ và bản mới (thiết kế của bài), ROUNDS đợt, đo ở các mốc CHECKPOINTS.
//   Pha 3: PAIRS cặp đợt tắt / bật trigger xen kẽ, so thời gian một đợt sửa hàng loạt.
// Kết thúc: trigger ở chế độ 'full' và bật; nhật ký giữ lại cho bench/history-query.ts.
// Ví dụ: RESULTS_DIR=bench/results/main pnpm bench:storage   (cần pnpm db:seed và pnpm db:migrate trước)
import type pg from 'pg';
import { adminClient, median, resetAuditLog, round, save, setAuditTrigger } from './lib';

const ROUNDS = Number(process.env.ROUNDS ?? 25);
const DIFF_ROUNDS = Number(process.env.DIFF_ROUNDS ?? 5);
const CHECKPOINTS = (process.env.CHECKPOINTS ?? '1,5,10,25').split(',').map(Number);
const PAIRS = Number(process.env.PAIRS ?? 3);
const BATCH = 1000;

const admin = await adminClient();
const { rows: [range] } = await admin.query<{ lo: number; hi: number }>('SELECT min(id)::int AS lo, max(id)::int AS hi FROM public.contracts WHERE id <= 40000');
const LO = range!.lo;
const HI = range!.hi;

let roundNo = 0;
/** Một đợt sửa phí toàn bộ hợp đồng seed; trả thời gian (ms). */
async function oneRound(c: pg.Client): Promise<number> {
  roundNo++;
  const t0 = performance.now();
  for (let start = LO, b = 0; start <= HI; start += BATCH, b++) {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.reason', $2, true), set_config('app.request_id', $3, true)", [
      `nv-${1 + ((b * 7 + roundNo * 13) % 300)}`,
      `Điều chỉnh phí đợt ${roundNo}`,
      `bench-${roundNo}-${b}`,
    ]);
    // Phí tăng / giảm 1 triệu xen kẽ theo đợt; updated_by đổi theo người sửa.
    await c.query(
      `UPDATE public.contracts SET premium = premium + $1, updated_by = current_setting('app.user_id'), updated_at = now()
       WHERE id BETWEEN $2 AND $3 AND deleted_at IS NULL`,
      [roundNo % 2 ? 1_000_000 : -1_000_000, start, Math.min(start + BATCH - 1, HI)],
    );
    await c.query('COMMIT');
  }
  return performance.now() - t0;
}

async function sizes(c: pg.Client) {
  await c.query('VACUUM (ANALYZE) audit.audit_log'); // bảng chỉ thêm: VACUUM để FSM/VM có mặt ở mọi lần đo như nhau
  const { rows } = await c.query(`
    SELECT (SELECT count(*) FROM audit.audit_log)::bigint                         AS rows,
           pg_relation_size('audit.audit_log')::bigint                            AS heap,
           (pg_table_size('audit.audit_log') - pg_relation_size('audit.audit_log'))::bigint AS toast_fsm_vm,
           pg_indexes_size('audit.audit_log')::bigint                             AS indexes,
           pg_total_relation_size('audit.audit_log')::bigint                      AS total,
           (SELECT round(avg(pg_column_size(old_row)))::int FROM audit.audit_log) AS avg_old_row_bytes,
           (SELECT round(avg(pg_column_size(new_row)))::int FROM audit.audit_log) AS avg_new_row_bytes`);
  const r = rows[0];
  return { ...r, bytesPerChange: r.rows ? round(r.total / r.rows, 1) : 0 };
}

const result: Record<string, unknown> = { seedRange: [LO, HI], batch: BATCH };
try {
  await admin.query('VACUUM (ANALYZE) public.contracts');
  const { rows: [base] } = await admin.query(
    "SELECT count(*)::int AS rows, pg_total_relation_size('public.contracts')::bigint AS total FROM public.contracts",
  );
  result.contractsTable = base; // bảng gốc ngay sau seed, để so với nhật ký
  console.log('Bảng contracts:', base);

  // Pha 1: diff
  await resetAuditLog(admin);
  await setAuditTrigger(admin, 'diff');
  const diff: unknown[] = [];
  for (let i = 1; i <= DIFF_ROUNDS; i++) {
    const ms = await oneRound(admin);
    if (i === 1 || i === DIFF_ROUNDS) diff.push({ rounds: i, roundMs: round(ms, 1), ...(await sizes(admin)) });
    console.log(`diff đợt ${i}: ${round(ms, 0)} ms`);
  }
  result.diff = diff;

  // Pha 2: full
  await resetAuditLog(admin);
  await setAuditTrigger(admin, 'full');
  const full: unknown[] = [];
  const fullRoundMs: number[] = [];
  for (let i = 1; i <= ROUNDS; i++) {
    const ms = await oneRound(admin);
    fullRoundMs.push(ms);
    console.log(`full đợt ${i}: ${round(ms, 0)} ms`);
    if (CHECKPOINTS.includes(i)) {
      const s = await sizes(admin);
      full.push({ rounds: i, ...s });
      console.log('  ', s);
    }
  }
  result.full = full;
  result.fullRoundMs = fullRoundMs.map((x) => round(x, 1));

  // Pha 3: đợt sửa hàng loạt, tắt / bật trigger xen kẽ (đổi thứ tự mỗi cặp)
  const bulk: { pair: number; state: 'off' | 'on'; ms: number }[] = [];
  for (let p = 1; p <= PAIRS; p++) {
    const states: ('off' | 'on')[] = p % 2 ? ['off', 'on'] : ['on', 'off'];
    for (const s of states) {
      await setAuditTrigger(admin, s);
      const ms = await oneRound(admin);
      bulk.push({ pair: p, state: s, ms: round(ms, 1) });
      console.log(`hàng loạt cặp ${p}, trigger ${s}: ${round(ms, 0)} ms`);
    }
  }
  await setAuditTrigger(admin, 'on');
  const off = bulk.filter((b) => b.state === 'off').map((b) => b.ms);
  const on = bulk.filter((b) => b.state === 'on').map((b) => b.ms);
  result.bulk = { runs: bulk, medianOffMs: median(off), medianOnMs: median(on), changesPerRound: HI - LO + 1 };
  result.finalAuditRows = (await admin.query('SELECT count(*)::int AS n FROM audit.audit_log')).rows[0].n;
} finally {
  await setAuditTrigger(admin, 'full');
  await admin.query('ALTER TABLE public.contracts ENABLE TRIGGER contracts_audit');
  await admin.end();
}
console.log(JSON.stringify(result, null, 2));
console.log('Đã ghi', save('storage.json', result));
