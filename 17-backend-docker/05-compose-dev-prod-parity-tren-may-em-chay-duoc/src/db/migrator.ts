import { sql } from 'kysely';
// Kysely 0.29 tách Migrator sang 'kysely/migration'.
import { Migrator, type Migration, type MigrationResult } from 'kysely/migration';
import * as m001 from './migrations/001-create-customers';
import { createDb } from './database';

// Danh sách migration tĩnh (không đọc thư mục lúc chạy): chạy giống nhau dưới tsx, Vitest và bản build.
const migrations: Record<string, Migration> = { '001-create-customers': m001 };

export interface MigrationRun {
  ok: boolean;
  /** Role thật sự chạy migration (current_user) và phiên bản server: ghi vào log để thấy ngay chạy bằng ai, ở đâu. */
  currentUser: string;
  serverVersion: string;
  results: Pick<MigrationResult, 'migrationName' | 'status'>[];
  error?: { message: string; code?: string };
  ms: number;
}

/** [PATTERN] Migration chạy bằng chuỗi kết nối của role owner (MIGRATION_DATABASE_URL), tách khỏi role ứng dụng. */
export async function runMigrations(connectionString: string): Promise<MigrationRun> {
  const started = performance.now();
  const db = createDb<unknown>(connectionString, 1);
  try {
    const who = await sql<{ u: string; v: string }>`SELECT current_user AS u, current_setting('server_version') AS v`.execute(db);
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
    const { error, results } = await migrator.migrateToLatest();
    const run: MigrationRun = {
      ok: !error,
      currentUser: who.rows[0]?.u ?? '?',
      serverVersion: who.rows[0]?.v ?? '?',
      results: (results ?? []).map(({ migrationName, status }) => ({ migrationName, status })),
      ms: performance.now() - started,
    };
    if (error) {
      const e = error as { message?: string; code?: string };
      run.error = { message: e.message ?? String(error), ...(e.code ? { code: e.code } : {}) };
    }
    return run;
  } finally {
    await db.destroy();
  }
}
