import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrator';
import { resetTestDb, testUrls, withClient } from './support/db';

// (b) Migration chạy bằng role owner (TEST_MIGRATION_DATABASE_URL) thành công trên PostgreSQL 16 của compose, và mọi
// bảng nó tạo thuộc owner (nên default privileges cấp DML cho role app). Phép thử âm: trỏ biến này sang role app.
describe('(b) migration bằng role owner', () => {
  beforeEach(resetTestDb);

  it('chạy thành công trên crm_test sạch, bằng app_owner (không phải superuser)', async () => {
    const run = await runMigrations(testUrls().migration);
    expect(run.error, `migration lỗi bằng role ${run.currentUser}: ${run.error?.message}`).toBeUndefined();
    expect(run.currentUser).toBe('app_owner');
    expect(run.results).toEqual([{ migrationName: '001-create-customers', status: 'Success' }]);
    const role = await withClient(testUrls().migration, (c) => c.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user'));
    expect(role.rows[0]).toEqual({ rolsuper: false });
  });

  it('mọi bảng trong public (kể cả bảng của Kysely) thuộc app_owner', async () => {
    const run = await runMigrations(testUrls().migration);
    expect(run.error, run.error?.message).toBeUndefined();
    const r = await withClient(testUrls().migration, (c) =>
      c.query<{ tablename: string; tableowner: string }>(
        `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      ),
    );
    expect(r.rows).toEqual([
      { tablename: 'customers', tableowner: 'app_owner' },
      { tablename: 'kysely_migration', tableowner: 'app_owner' },
      { tablename: 'kysely_migration_lock', tableowner: 'app_owner' },
    ]);
  });

  it('chạy lại lần hai không làm gì và không lỗi', async () => {
    await runMigrations(testUrls().migration);
    const again = await runMigrations(testUrls().migration);
    expect(again.error, again.error?.message).toBeUndefined();
    expect(again.results).toEqual([]);
  });
});
