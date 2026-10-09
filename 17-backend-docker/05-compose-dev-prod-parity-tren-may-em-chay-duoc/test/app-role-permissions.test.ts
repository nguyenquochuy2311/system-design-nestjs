import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrator';
import { pgErrorOf, resetTestDb, testUrls, withClient } from './support/db';

// (a) Role ứng dụng trên PostgreSQL 16 của compose: không tạo được bảng trong public, nhưng đọc ghi được dữ liệu.
// Kiểm cả bằng kết nối thật lẫn ở mức catalog (has_*_privilege, pg_class), không chỉ "câu lệnh chạy được".
describe('(a) role app chỉ có quyền dữ liệu trên schema public', () => {
  let app: pg.Client;
  const withApp = <T>(fn: (c: pg.Client) => Promise<T>) => fn(app);

  beforeAll(async () => {
    await resetTestDb();
    const run = await runMigrations(testUrls().migration);
    expect(run.error, run.error?.message).toBeUndefined();
    app = new pg.Client({ connectionString: testUrls().app });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('role app không phải superuser, không CREATEDB/CREATEROLE và không sở hữu database', () =>
    withApp(async (c) => {
      const r = await c.query(
        `SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, d.datdba = r.oid AS owns_db
           FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = current_database()`,
      );
      expect(r.rows[0]).toEqual({ rolname: 'app_user', rolsuper: false, rolcreatedb: false, rolcreaterole: false, owns_db: false });
    }));

  it('catalog: có USAGE nhưng không có CREATE trên schema public, không CREATE/TEMPORARY trên database', () =>
    withApp(async (c) => {
      const r = await c.query(
        `SELECT has_schema_privilege('public', 'USAGE') AS usage,
                has_schema_privilege('public', 'CREATE') AS create_in_public,
                has_database_privilege(current_database(), 'CREATE') AS create_schema,
                has_database_privilege(current_database(), 'TEMPORARY') AS temp`,
      );
      expect(r.rows[0]).toEqual({ usage: true, create_in_public: false, create_schema: false, temp: false });
    }));

  it('kết nối thật: CREATE TABLE trong public bị từ chối (42501 permission denied for schema public)', () =>
    withApp(async (c) => {
      for (const stmt of ['CREATE TABLE public.app_tmp (id int)', 'CREATE TABLE app_tmp (id int)']) {
        const e = await pgErrorOf(c, stmt);
        expect(e?.code, stmt).toBe('42501');
        expect(e?.message).toMatch(/permission denied for schema public/);
      }
    }));

  it('catalog: có SELECT/INSERT/UPDATE/DELETE trên customers, không có TRUNCATE/REFERENCES/TRIGGER', () =>
    withApp(async (c) => {
      const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
      const r = await c.query(`SELECT ${privs.map((p) => `has_table_privilege('public.customers', '${p}') AS "${p}"`).join(', ')}`);
      expect(r.rows[0]).toEqual({ SELECT: true, INSERT: true, UPDATE: true, DELETE: true, TRUNCATE: false, REFERENCES: false, TRIGGER: false });
    }));

  it('kết nối thật: INSERT, SELECT, UPDATE, DELETE trên customers chạy được', () =>
    withApp(async (c) => {
      const email = `a-${Date.now()}@vi-du.test`;
      const ins = await c.query<{ id: string }>('INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id', ['Công ty A', email]);
      const id = ins.rows[0]?.id;
      expect(id).toBeDefined();
      expect((await c.query('UPDATE customers SET name = $1 WHERE id = $2', ['Công ty A2', id])).rowCount).toBe(1);
      expect((await c.query('SELECT name FROM customers WHERE id = $1', [id])).rows).toEqual([{ name: 'Công ty A2' }]);
      expect((await c.query('DELETE FROM customers WHERE id = $1', [id])).rowCount).toBe(1);
    }));

  it('kết nối thật: không DROP, ALTER hay TRUNCATE được bảng do owner tạo', () =>
    withApp(async (c) => {
      expect((await pgErrorOf(c, 'DROP TABLE customers'))?.message).toMatch(/must be owner of table customers/);
      expect((await pgErrorOf(c, 'ALTER TABLE customers ADD COLUMN x int'))?.message).toMatch(/must be owner of table customers/);
      expect((await pgErrorOf(c, 'TRUNCATE customers'))?.code).toBe('42501');
    }));

  it('bất biến: không đối tượng nào trong public thuộc role app', () =>
    withClient(testUrls().migration, async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE n.nspname = 'public' AND k.relowner = 'app_user'::regrole`,
      );
      expect(r.rows[0]).toEqual({ n: 0 });
    }));
});
