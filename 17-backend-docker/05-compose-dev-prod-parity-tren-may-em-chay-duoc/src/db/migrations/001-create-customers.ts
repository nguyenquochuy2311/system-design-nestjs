import { sql, type Kysely } from 'kysely';

// Migration của ứng dụng: tạo bảng trong schema public. Trên PostgreSQL 15+ chỉ chạy được bằng role có quyền CREATE
// trên public (owner của database), không chạy được bằng role ứng dụng.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('customers')
    .addColumn('id', 'bigint', (c) => c.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('customers').execute();
}
