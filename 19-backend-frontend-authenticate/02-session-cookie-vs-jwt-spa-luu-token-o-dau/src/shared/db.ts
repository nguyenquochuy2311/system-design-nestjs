import { Pool } from 'pg';

export const DB = Symbol('DB');

export interface DbOptions {
  connectionString: string;
  /** Schema riêng cho test (lab_test) — file schema.sql không ghi tên schema (nhật ký 01/02 điểm 2). */
  schema?: string;
  max?: number;
}

/** Tạo pool `pg`. Test dùng schema riêng qua search_path nên nạp cùng một schema.sql. */
export function createPool(opts: DbOptions): Pool {
  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}),
  });
  pool.on('error', () => {});
  return pool;
}
