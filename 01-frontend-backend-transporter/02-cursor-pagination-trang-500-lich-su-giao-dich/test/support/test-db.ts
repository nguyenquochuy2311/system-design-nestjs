import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../../src/app.js';
import { createDb, type Database } from '../../src/shared/db.js';

export const TEST_SCHEMA = 'lab_test';
export const TEST_SECRET = 'khoa-ky-cursor-chi-dung-trong-test';

// Không dùng `new URL(..., import.meta.url)`: môi trường happy-dom thay URL toàn cục.
const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');
const sqlFile = (name: string) => readFileSync(resolve(DB_DIR, name), 'utf8');

/** Câu lệnh của một file SQL, bỏ dòng chú thích. CREATE INDEX CONCURRENTLY phải chạy riêng từng câu, ngoài transaction. */
function statements(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Dựng lại schema `lab_test` giống bản "sau" (schema.sql + index của pattern), trả về Kysely trỏ vào schema đó. */
export async function setupTestDb(): Promise<Kysely<Database>> {
  const admin = createDb({ max: 1 });
  await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA}`).execute(admin);
  await admin.destroy();
  const db = createDb({ schema: TEST_SCHEMA, max: 5 });
  for (const s of [...statements(sqlFile('schema.sql')), ...statements(sqlFile('add-keyset-index.sql'))]) {
    await sql.raw(s).execute(db);
  }
  return db;
}

export function testApp(db: Kysely<Database>) {
  return buildApp({ db, cursorSecret: TEST_SECRET });
}

/**
 * Sinh `count` giao dịch cũ cho một merchant theo cùng quy luật với db/seed-transactions.sql: khối 5 dòng,
 * một nửa số khối có 5 dòng trùng hệt created_at, khối còn lại lệch nhau 1 micro giây.
 */
export async function seedHistory(db: Kysely<Database>, merchantId: number, count: number, startIso = '2026-09-01T00:00:00.000000Z') {
  await sql`
    INSERT INTO transactions (merchant_id, created_at, amount, kind, description)
    SELECT ${merchantId}::int,
           ${startIso}::timestamptz - make_interval(secs => ((g - 1) / 5) * 1.5)
             + (CASE WHEN ((g - 1) / 5) % 2 = 1 THEN 0 ELSE (g - 1) % 5 END) * interval '1 microsecond',
           10000 + g, 'payment', 'Giao dịch thử #' || g
    FROM generate_series(1, ${count}::int) AS g`.execute(db);
  await sql`ANALYZE transactions`.execute(db);
}

/** Thêm n giao dịch "vừa xảy ra" (created_at = clock_timestamp(), mới hơn mọi dòng seed). */
export async function insertNewTransactions(db: Kysely<Database>, merchantId: number, n: number): Promise<string[]> {
  const rows = await db
    .insertInto('transactions')
    .values(Array.from({ length: n }, (_, k) => ({ merchant_id: merchantId, amount: 50000 + k, kind: 'payment', description: 'Giao dịch mới' })))
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
}

export async function insertAt(db: Kysely<Database>, merchantId: number, createdAt: string[]): Promise<void> {
  await db
    .insertInto('transactions')
    .values(createdAt.map((t, k) => ({ merchant_id: merchantId, created_at: t, amount: 1000 + k, kind: 'payment', description: `Cùng lô ${k}` })))
    .execute();
}

/** Toàn bộ id của merchant theo đúng thứ tự hiển thị — "đáp án" để so khi lật trang. */
export async function idsInDisplayOrder(db: Kysely<Database>, merchantId: number): Promise<string[]> {
  const rows = await db.selectFrom('transactions').select('id').where('merchant_id', '=', merchantId)
    .orderBy('created_at', 'desc').orderBy('id', 'desc').execute();
  return rows.map((r) => r.id);
}

export function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
}
