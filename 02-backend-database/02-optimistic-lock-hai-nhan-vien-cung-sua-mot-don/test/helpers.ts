import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/shared/db';
import { toShipment, type Shipment } from '../src/shared/shipment';

/** Cùng câu với db/add-version-column.sql nên chạy test trước hay sau pnpm db:migrate đều được. */
export async function ensureVersionColumn(db: Kysely<Database>): Promise<void> {
  await sql`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`.execute(db);
}

/** Mỗi test tự tạo vận đơn riêng: không phụ thuộc seed, không đụng dữ liệu của test khác hay của k6. */
export async function createShipment(db: Kysely<Database>): Promise<Shipment> {
  const code = `TEST-${randomUUID()}`;
  const row = await db
    .insertInto('shipments')
    .values({
      tracking_code: code,
      recipient_name: 'Chị Lan',
      address: '12 Lê Lợi, Quận 1',
      appointment_at: '2026-10-08T02:00:00.000Z',
      cod_cents: 350_000,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toShipment(row);
}

/** Đợi một promise và trả về kết quả hoặc lỗi, để đếm "thành công / bị từ chối" khi chạy đồng thời. */
export async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
