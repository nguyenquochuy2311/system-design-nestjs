import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

export interface Database {
  shipments: {
    id: Generated<number>;
    tracking_code: string;
    recipient_name: string;
    address: string;
    appointment_at: ColumnType<Date, string, string>; // đọc ra Date, ghi vào chuỗi ISO từ form
    cod_cents: number;
    note: Generated<string>;
    updated_by: Generated<string>;
    updated_at: Generated<Date>;
    // Có sau migration db/add-version-column.sql; code "trước" không ghi cột này (không tăng version).
    version: Generated<number>;
  };
}

export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:55432/logistics';

export function createDb(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Kysely<Database> {
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }) });
}
