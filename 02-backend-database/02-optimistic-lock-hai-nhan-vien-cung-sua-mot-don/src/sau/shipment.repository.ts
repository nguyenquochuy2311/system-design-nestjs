import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import {
  ConcurrentModificationError,
  formColumns,
  getShipment,
  ShipmentNotFoundError,
  toShipment,
  type Shipment,
  type ShipmentForm,
} from '../shared/shipment';

/**
 * [PATTERN] PHIÊN BẢN "SAU": Optimistic Offline Lock (Fowler, PoEAA).
 * Form mang theo version đã đọc. Phép kiểm tra version và phép ghi nằm trong CÙNG một câu UPDATE,
 * nên nguyên tử ngay dưới Read Committed: nếu hai câu cùng chạy, câu sau chờ khóa dòng, rồi PostgreSQL
 * đánh giá lại WHERE trên bản đã commit, thấy version đã đổi và cập nhật 0 dòng.
 * Mọi đường ghi vào vận đơn (API, job nền, script sửa dữ liệu) phải đi qua hàm này.
 */
export async function saveShipment(
  db: Kysely<Database>,
  id: number,
  expectedVersion: number,
  form: ShipmentForm,
  updatedBy: string,
): Promise<Shipment> {
  const row = await db
    .updateTable('shipments')
    .set({ ...formColumns(form, updatedBy), updated_at: sql`now()`, version: sql`version + 1` }) // [PATTERN] mỗi lần ghi tăng version
    .where('id', '=', id)
    .where('version', '=', expectedVersion) // [PATTERN] chỉ ghi nếu DB vẫn là bản người dùng đã nhìn thấy
    .returningAll()
    .executeTakeFirst();
  if (row) return toShipment(row);

  // 0 dòng có hai nghĩa: vận đơn không tồn tại (404) hoặc đã bị người khác sửa (409). Phân biệt bằng một lần đọc.
  const current = await getShipment(db, id);
  if (!current) throw new ShipmentNotFoundError(id);
  throw new ConcurrentModificationError(current, expectedVersion);
}
