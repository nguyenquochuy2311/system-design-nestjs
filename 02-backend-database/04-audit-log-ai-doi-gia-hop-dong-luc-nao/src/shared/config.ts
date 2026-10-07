// Chuỗi kết nối phía host. Mỗi "đường ghi" dùng đúng tài khoản DB của nó (xem db/init.sql).
export const APP_URL = process.env.DATABASE_URL ?? 'postgres://contract_app:contract_app@localhost:55432/insurance';
export const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/insurance';
export const OPS_SCRIPT_URL = process.env.OPS_SCRIPT_DATABASE_URL ?? 'postgres://ops_script:ops_script@localhost:55432/insurance';
export const DBA_URL = process.env.DBA_DATABASE_URL ?? 'postgres://dba_lan:dba_lan@localhost:55432/insurance';
export const PGBOUNCER_URL = process.env.PGBOUNCER_URL ?? 'postgres://contract_app:contract_app@localhost:56432/insurance';

/** Đổi tên database trong chuỗi kết nối (PgBouncer có database "insurance_one" chỉ 1 kết nối thật). */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Thư mục của bài: cwd cho các lệnh docker compose (đường ghi psql, bật/tắt trigger khi đo). */
export const LAB_DIR = new URL('../..', import.meta.url).pathname;
