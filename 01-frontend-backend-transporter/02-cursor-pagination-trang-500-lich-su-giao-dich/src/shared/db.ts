import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

export interface TransactionsTable {
  // bigint: driver pg trả chuỗi, giữ nguyên để không mất chữ số.
  id: Generated<string>;
  merchant_id: number;
  // Chuỗi, không phải Date: pool bên dưới tắt bộ chuyển timestamptz → Date (Date chỉ giữ tới mili giây).
  created_at: ColumnType<string, string | undefined, never>;
  amount: ColumnType<string, number | string, never>;
  kind: string;
  description: string;
}

export interface Database {
  transactions: TransactionsTable;
}

export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/ledger';

export interface DbOptions {
  connectionString?: string;
  /** Test chạy trong schema riêng (`lab_test`) để không đụng dữ liệu seed dùng cho đo. */
  schema?: string;
  max?: number;
}

const TIMESTAMPTZ_OID = 1184;
const keepTimestampAsText: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === TIMESTAMPTZ_OID ? (value: string) => value : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig['getTypeParser'],
};

export function createDb(opts: DbOptions = {}): Kysely<Database> {
  const pool = new pg.Pool({
    types: keepTimestampAsText,
    connectionString: opts.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    max: opts.max ?? 10,
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}),
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
