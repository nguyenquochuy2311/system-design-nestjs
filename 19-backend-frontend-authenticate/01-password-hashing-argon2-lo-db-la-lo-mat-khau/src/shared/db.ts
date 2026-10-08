import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

// bigint (INT8) trả về dạng chuỗi để không mất chữ số; id đi ra API dưới dạng chuỗi.
export interface Database {
  users: {
    id: Generated<string>;
    email: string;
    // NULL sau khi đã di trú: migration/nâng cấp phải xóa MD5 cùng lúc với việc ghi hash mới.
    password_md5: string | null;
    password_hash: string | null;
    hash_version: ColumnType<number, number | undefined, number>;
    created_at: Generated<Date>;
  };
}

/** Token DI của Kysely: interface TypeScript không tồn tại lúc chạy (nhật ký 08/01 điểm 1: luôn @Inject tường minh). */
export const KYSELY = Symbol('KYSELY');
export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/accounts';

export interface DbOptions {
  connectionString?: string;
  /** Test chạy trong schema riêng (`lab_test`) để không đụng dữ liệu dùng cho đo/tấn công. */
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
