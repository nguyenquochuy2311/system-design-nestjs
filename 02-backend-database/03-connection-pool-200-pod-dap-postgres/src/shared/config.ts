// Chuỗi kết nối của lab. Mật khẩu là giá trị chỉ dùng trong lab (khớp db/init.sql và infra/pgbouncer/userlist.txt).
// Dùng 127.0.0.1 thay cho localhost để không mất thời gian thử IPv6 trước.

/** Kết nối thẳng tới PostgreSQL bằng role ứng dụng (không phải superuser). */
export const DIRECT_URL = process.env.DATABASE_URL_DIRECT ?? 'postgres://wallet_app:wallet_app@127.0.0.1:55432/wallet';

/** Hai instance PgBouncer; pod số i dùng instance i % 2. */
export const PGBOUNCER_URLS = (
  process.env.PGBOUNCER_URLS ??
  'postgres://wallet_app:wallet_app@127.0.0.1:56432/wallet,postgres://wallet_app:wallet_app@127.0.0.1:56433/wallet'
).split(',');

/** Superuser: dùng một trong 3 chỗ superuser_reserved_connections, nên vẫn đo được khi ứng dụng đã làm DB đầy. */
export const ADMIN_URL = process.env.DATABASE_URL_ADMIN ?? 'postgres://postgres:postgres@127.0.0.1:55432/wallet';

/** Console quản trị của từng instance PgBouncer (database ảo "pgbouncer"). */
export const PGBOUNCER_ADMIN_URLS = (
  process.env.PGBOUNCER_ADMIN_URLS ??
  'postgres://pgbouncer_admin:pgbouncer_admin@127.0.0.1:56432/pgbouncer,postgres://pgbouncer_admin:pgbouncer_admin@127.0.0.1:56433/pgbouncer'
).split(',');

/** Đổi database trong một chuỗi kết nối (test dùng database "wallet_one" của PgBouncer: đúng 1 kết nối thật). */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
