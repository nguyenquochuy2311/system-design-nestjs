import { sql, type Kysely } from 'kysely';
import type { AuditLogTable, Database } from '../shared/db';

/** Một lần một trường thay đổi: câu trả lời cho kiểm toán "ai đổi, lúc nào, từ bao nhiêu sang bao nhiêu, vì sao". */
export interface FieldChange {
  changedAt: string;
  action: AuditLogTable['action'];
  actor: string;
  dbUser: string;
  reason: string | null;
  requestId: string | null;
  from: unknown;
  to: unknown;
}

/**
 * Lịch sử của một trường trên một dòng, cũ trước mới sau. Dùng index (table_name, row_id, changed_at).
 * Trả builder để bench/history-query.ts chạy EXPLAIN ANALYZE đúng câu SQL mà API dùng.
 */
export function fieldHistoryQuery(db: Kysely<Database>, table: string, rowId: number, field: string) {
  return db
    .selectFrom('audit.audit_log')
    .select([
      'id',
      'changed_at',
      'action',
      'actor',
      'db_user',
      'reason',
      'request_id',
      sql<unknown>`old_row -> ${field}`.as('from_value'),
      sql<unknown>`new_row -> ${field}`.as('to_value'),
    ])
    .where('table_name', '=', table)
    .where('row_id', '=', rowId)
    // INSERT / DELETE luôn liên quan (giá trị đầu, giá trị cuối); UPDATE chỉ khi trường đó nằm trong changed_fields.
    .where((eb) => eb.or([eb('action', 'in', ['INSERT', 'DELETE']), sql<boolean>`${field} = ANY (changed_fields)`]))
    .orderBy('changed_at')
    .orderBy('id');
}

export async function fieldHistory(db: Kysely<Database>, table: string, rowId: number, field: string): Promise<FieldChange[]> {
  const rows = await fieldHistoryQuery(db, table, rowId, field).execute();
  return rows.map((r) => ({
    changedAt: r.changed_at.toISOString(),
    action: r.action,
    actor: r.actor,
    dbUser: r.db_user,
    reason: r.reason,
    requestId: r.request_id,
    from: r.from_value ?? null,
    to: r.to_value ?? null,
  }));
}

/** Toàn bộ nhật ký của một dòng (mọi trường), dùng để khôi phục bản cũ hoặc xem ai xóa. */
export async function rowHistory(db: Kysely<Database>, table: string, rowId: number) {
  return db
    .selectFrom('audit.audit_log')
    .selectAll()
    .where('table_name', '=', table)
    .where('row_id', '=', rowId)
    .orderBy('changed_at')
    .orderBy('id')
    .execute();
}
