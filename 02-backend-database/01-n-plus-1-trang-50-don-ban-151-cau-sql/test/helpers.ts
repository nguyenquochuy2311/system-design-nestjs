import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/shared/db';

/** Tên index trùng với db/add-foreign-key-indexes.sql nên hai nơi tạo index đều idempotent. */
export async function ensureForeignKeyIndexes(db: Kysely<Database>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments (order_id)`.execute(db);
  await sql`ANALYZE order_items`.execute(db);
  await sql`ANALYZE shipments`.execute(db);
}
