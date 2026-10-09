import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv, requireEnv } from '../src/config';
import { runMigrations, type MigrationRun } from '../src/db/migrator';
import { environment, LAB, machine, PG14_IMAGE, PG16_IMAGE, sh } from './lib/run';

// Bước 2 ("trước") + đối chứng "sau": cùng một migration chạy trên
//   - PostgreSQL 14.24 và 16.15 dựng GIỐNG HỆT nhau (container mới, role app tạo kiểu production: LOGIN + CONNECT,
//     database thuộc superuser) — chỉ khác phiên bản;
//   - mỗi bản chạy bằng superuser (kiểu máy dev cũ) và bằng role app không phải owner (kiểu production);
//   - PostgreSQL 16.15 của compose (init script của lab) bằng role app và bằng role owner.
// Chỉ số đúng/sai nên một lượt là đủ (quy-trinh-lab 5b). Ghi bench/results/<tên lượt>/matrix.json.
// Cần: compose của lab đang chạy (`docker compose up -d --wait`) và .env. Cổng 55433 cho container tạm.
loadDotEnv();
const outDir = join(LAB, 'bench/results', process.argv[2] ?? 'main');
mkdirSync(outDir, { recursive: true });

interface Case extends Omit<MigrationRun, 'ms'> {
  server: string;
  setup: string;
  ms: number;
  rolsuper?: boolean;
  createOnPublic?: boolean;
  tableOwners?: Record<string, string>;
  serverLogError?: string[];
}

async function catalog(url: string): Promise<Pick<Case, 'rolsuper' | 'createOnPublic' | 'tableOwners'>> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ rolsuper: boolean; create_on_public: boolean }>(
      `SELECT rolsuper, has_schema_privilege('public', 'CREATE') AS create_on_public FROM pg_roles WHERE rolname = current_user`,
    );
    const t = await c.query<{ tablename: string; tableowner: string }>(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public'`);
    return {
      rolsuper: r.rows[0]?.rolsuper,
      createOnPublic: r.rows[0]?.create_on_public,
      tableOwners: Object.fromEntries(t.rows.map((x) => [x.tablename, x.tableowner])),
    };
  } finally {
    await c.end();
  }
}

async function waitTcp(url: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const c = new pg.Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await c.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`PostgreSQL không lên: ${url.replace(/:[^:@/]+@/, ':***@')}`);
}

/** Container tạm (nhãn lab.id=17-05), role app tạo kiểu production; chạy migration bằng superuser và bằng role app. */
async function plainContainer(image: string): Promise<Case[]> {
  const name = 'lab-17-05-matrix';
  const superPw = randomBytes(9).toString('hex');
  const appPw = randomBytes(9).toString('hex');
  sh(`docker rm -f -v ${name}`);
  const run = sh(`docker run -d --name ${name} --label lab.id=17-05 -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD=${superPw} ${image}`);
  if (run.code !== 0) throw new Error(run.out);
  const base = `127.0.0.1:55433`;
  const superUrl = (db: string) => `postgres://postgres:${superPw}@${base}/${db}`;
  const appUrl = (db: string) => `postgres://app_user:${appPw}@${base}/${db}`;
  try {
    await waitTcp(superUrl('postgres'));
    const admin = new pg.Client({ connectionString: superUrl('postgres') });
    await admin.connect();
    // Như DBA dựng production: database thuộc tài khoản quản trị, role app chỉ LOGIN + CONNECT, không cấp CREATE.
    await admin.query(`CREATE ROLE app_user LOGIN PASSWORD '${appPw}'`);
    for (const db of ['crm_super', 'crm_app']) {
      await admin.query(`CREATE DATABASE ${db}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${db} TO app_user`);
    }
    const server = (await admin.query<{ v: string }>(`SELECT current_setting('server_version') AS v`)).rows[0]?.v ?? '?';
    await admin.end();
    const setup = 'container mới; database thuộc superuser; app_user LOGIN + CONNECT, không GRANT CREATE';
    const cases: Case[] = [];
    for (const [db, url] of [['crm_super', superUrl('crm_super')], ['crm_app', appUrl('crm_app')]] as const) {
      const before = await catalog(url);
      const r = await runMigrations(url);
      const after = await catalog(url);
      cases.push({ server, setup, ...r, rolsuper: before.rolsuper, createOnPublic: before.createOnPublic, tableOwners: after.tableOwners });
      void db;
    }
    // Câu lệnh bị từ chối, nguyên văn từ log server (log_min_error_statement mặc định = error).
    const log = sh(`docker logs ${name} 2>&1 | grep -E 'ERROR|STATEMENT' | head -6`).out.trim();
    if (log) cases[cases.length - 1]!.serverLogError = log.split('\n');
    return cases;
  } finally {
    sh(`docker rm -f -v ${name}`);
  }
}

/** PostgreSQL 16.15 của compose (init script của lab): role app rồi role owner, trên crm_test đã xóa bảng. */
async function composeCases(): Promise<Case[]> {
  const owner = requireEnv('TEST_MIGRATION_DATABASE_URL');
  const app = requireEnv('TEST_DATABASE_URL');
  const reset = new pg.Client({ connectionString: owner });
  await reset.connect();
  await reset.query('DROP TABLE IF EXISTS customers, kysely_migration, kysely_migration_lock');
  await reset.end();
  const setup = 'compose.yaml + infra/postgres-init (app_owner sở hữu database, app_user chỉ DML)';
  const cases: Case[] = [];
  for (const url of [app, owner]) {
    const before = await catalog(url);
    const r = await runMigrations(url);
    const after = await catalog(url);
    cases.push({ server: r.serverVersion, setup, ...r, rolsuper: before.rolsuper, createOnPublic: before.createOnPublic, tableOwners: after.tableOwners });
  }
  const log = sh(`docker compose logs postgres 2>&1 | grep -E 'ERROR|STATEMENT' | tail -2`).out.trim();
  if (log) cases[0]!.serverLogError = log.split('\n');
  return cases;
}

const result = {
  machine: machine(),
  environment: environment(),
  images: { pg14: PG14_IMAGE, pg16: PG16_IMAGE },
  cases: [...(await plainContainer(PG14_IMAGE)), ...(await plainContainer(PG16_IMAGE)), ...(await composeCases())],
};
writeFileSync(join(outDir, 'matrix.json'), JSON.stringify(result, null, 2));
for (const c of result.cases) {
  console.log(
    `${c.server.split(' ')[0]!.padEnd(6)} ${c.currentUser.padEnd(10)} super=${String(c.rolsuper).padEnd(5)} CREATE(public)=${String(c.createOnPublic).padEnd(5)} → ${c.ok ? 'OK ' : 'LỖI'} ${c.error ? `[${c.error.code}] ${c.error.message}` : JSON.stringify(c.tableOwners)} (${c.ms.toFixed(0)} ms)`,
  );
}
console.log(`→ ${join(outDir, 'matrix.json')}`);
