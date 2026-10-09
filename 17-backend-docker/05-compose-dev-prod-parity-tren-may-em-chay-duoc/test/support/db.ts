import pg from 'pg';
import { requireEnv } from '../../src/config';

/** Chuỗi kết nối test (database crm_test): app = role ứng dụng, migration = role chạy migration (phải là owner). */
export function testUrls(): { app: string; migration: string } {
  return { app: requireEnv('TEST_DATABASE_URL'), migration: requireEnv('TEST_MIGRATION_DATABASE_URL') };
}

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Lỗi PostgreSQL của một câu lệnh (undefined nếu câu chạy được) — để test khẳng định đúng mã lỗi, không chỉ "có lỗi". */
export async function pgErrorOf(c: pg.Client, statement: string): Promise<{ code?: string; message: string } | undefined> {
  try {
    await c.query(statement);
    return undefined;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code, message: err.message };
  }
}

/**
 * Xóa bảng của lab trong crm_test bằng role migration (owner xóa được bảng của chính nó) để migration chạy từ đầu.
 * Không có bảng thì là no-op, nên vẫn chạy được khi role migration bị cấu hình nhầm (phép thử âm).
 */
export async function resetTestDb(): Promise<void> {
  await withClient(testUrls().migration, (c) => c.query('DROP TABLE IF EXISTS customers, kysely_migration, kysely_migration_lock'));
}
