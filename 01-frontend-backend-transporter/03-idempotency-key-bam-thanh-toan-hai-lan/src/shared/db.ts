import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8) trả về dạng chuỗi để không mất chữ số; tiền và id đi ra API dưới dạng chuỗi.
export interface Database {
  wallets: { user_id: string | number; balance: ColumnType<string, number | string, number | string> };
  payments: {
    id: Generated<string>;
    user_id: string | number;
    merchant_id: number;
    amount: ColumnType<string, number | string, never>;
    note: string;
    created_at: Generated<Date>;
  };
  idempotency_keys: {
    user_id: string | number;
    idempotency_key: string;
    request_method: string;
    request_path: string;
    fingerprint: string;
    status: Generated<'processing' | 'completed'>;
    locked_at: Date | null;
    response_code: number | null;
    response_body: string | null;
    created_at: Generated<Date>;
    completed_at: Date | null;
  };
}

/** Token DI của Kysely: interface TypeScript không tồn tại lúc chạy (nhật ký 08/01 điểm 1: luôn @Inject tường minh). */
export const KYSELY = Symbol('KYSELY');
export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/wallet';

export interface DbOptions {
  connectionString?: string;
  /** Test chạy trong schema riêng (`lab_test`) để không đụng dữ liệu dùng cho đo. */
  schema?: string;
  max?: number;
}

export function createDb(opts: DbOptions = {}): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString: opts.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    max: opts.max ?? 10,
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}),
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
