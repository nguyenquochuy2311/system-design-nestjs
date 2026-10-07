import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';
import { APP_URL } from './config';

// bigint (int8) của PostgreSQL mặc định về chuỗi; tiền và id trong lab nhỏ hơn 2^53 nên đổi sang number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// date giữ nguyên chuỗi 'YYYY-MM-DD', tránh lệch ngày do múi giờ khi đổi sang Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

// Có DEFAULT now(): chèn không cần, sửa thì truyền Date, chuỗi hoặc sql`now()`.
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface ContractTable {
  id: Generated<number>;
  code: string;
  customer_name: string;
  product: string;
  premium: number;
  sum_insured: number;
  start_date: string;
  end_date: string;
  updated_by: Generated<string>;
  updated_at: Timestamp;
  // Chỉ có ở public.contracts sau migration 002; code "trước" không đọc / ghi hai cột này.
  deleted_at: ColumnType<Date | null, never, Date | string | null>;
  deleted_by: ColumnType<string | null, never, string | null>;
}

export interface ClaimTable {
  id: Generated<number>;
  contract_id: number;
  amount: number;
  status: Generated<string>;
  created_at: Timestamp;
}

export interface AuditLogTable {
  id: Generated<number>;
  table_name: string;
  row_id: number;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE' | 'RESTORE';
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_fields: string[] | null;
  actor: string;
  db_user: string;
  reason: string | null;
  request_id: string | null;
  txid: number;
  changed_at: Date;
}

export interface AppAuditLogTable {
  id: Generated<number>;
  contract_id: number;
  action: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string;
  changed_at: Generated<Date>;
}

export interface Database {
  contracts: ContractTable; // public.contracts, hoặc truoc.contracts qua db.withSchema('truoc')
  claims: ClaimTable;
  active_contracts: Omit<ContractTable, 'deleted_at' | 'deleted_by'>; // view lọc bản xóa mềm (migration 002)
  'audit.audit_log': AuditLogTable;
  app_audit_log: AppAuditLogTable; // chỉ có ở schema truoc (phương án "ghi nhật ký trong repository")
}

export function createDb(connectionString = APP_URL, max = Number(process.env.DB_POOL_MAX ?? 10)): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }) });
}
