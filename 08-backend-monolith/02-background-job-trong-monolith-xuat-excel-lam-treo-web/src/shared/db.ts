import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';
import Cursor from 'pg-cursor';

// bigint (INT8) trả về dạng number: tiền tính bằng đồng và id đều nằm dưới 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Database {
  tenants: { id: Generated<number>; name: string };
  users: { id: Generated<number>; tenant_id: number; name: string; role: string };
  orders: {
    id: Generated<number>;
    tenant_id: number;
    code: string;
    store_name: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    item_count: number;
    subtotal: number;
    discount: number;
    total: number;
    created_at: ColumnType<Date, Date | string | undefined, never>;
  };
  export_jobs: {
    id: Generated<number>;
    tenant_id: number;
    requested_by: number;
    filter: ColumnType<ExportFilter, string, string>;
    filter_hash: string;
    status: ColumnType<JobStatus, JobStatus | undefined, JobStatus>;
    attempts: Generated<number>;
    rows_written: Generated<number>;
    row_count: number | null;
    object_key: string | null;
    last_error: string | null;
    created_at: ColumnType<Date, never, never>;
    started_at: ColumnType<Date | null, never, Date | null>;
    finished_at: ColumnType<Date | null, never, Date | null>;
  };
}

/** Bộ lọc của một lần xuất: một tháng dữ liệu của tenant. */
export interface ExportFilter {
  month: string; // YYYY-MM
}

/** Token DI của Kysely: interface TypeScript không tồn tại lúc chạy nên NestJS cần một token thật. */
export const KYSELY = Symbol('KYSELY');

export function createDb(connectionString: string, max = 10): Kysely<Database> {
  return new Kysely<Database>({
    // `cursor` bật `.stream()` của Kysely: đọc từng lô qua portal phía server (pg-cursor), không tải hết vào bộ nhớ
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }), cursor: Cursor }),
  });
}
