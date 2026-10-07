import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { formColumns, ShipmentNotFoundError, toShipment, type Shipment, type ShipmentForm } from '../shared/shipment';

/**
 * PHIÊN BẢN "TRƯỚC": tái hiện lost update.
 * Ghi lại toàn bộ trường của form, WHERE chỉ có id => ai lưu sau thắng. Form của người lưu sau
 * chứa giá trị cũ của những trường người lưu trước vừa sửa, nên thay đổi đó bị xóa mà không ai được báo.
 */
export async function saveShipmentLastWriteWins(
  db: Kysely<Database>,
  id: number,
  form: ShipmentForm,
  updatedBy: string,
): Promise<Shipment> {
  const row = await db
    .updateTable('shipments')
    .set({ ...formColumns(form, updatedBy), updated_at: sql`now()` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new ShipmentNotFoundError(id);
  return toShipment(row);
}
