import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { formColumns, ShipmentNotFoundError, toShipment, type Shipment, type ShipmentForm } from '../shared/shipment';

/**
 * PHƯƠNG ÁN SO SÁNH ở mục 2: khóa dòng bằng `SELECT ... FOR UPDATE` trong transaction của request "Lưu".
 * Khóa chỉ sống trong transaction ngắn này. Dữ liệu người dùng dựa vào để sửa được đọc ở request GET
 * vài phút trước, nằm ngoài transaction, nên form cũ vẫn ghi đè thay đổi người khác đã commit.
 * Hai request lưu cùng lúc chỉ bị xếp hàng lần lượt, không bị từ chối.
 */
export async function saveShipmentSelectForUpdate(
  db: Kysely<Database>,
  id: number,
  form: ShipmentForm,
  updatedBy: string,
): Promise<Shipment> {
  return db.transaction().execute(async (trx) => {
    const locked = await trx.selectFrom('shipments').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!locked) throw new ShipmentNotFoundError(id);
    const row = await trx
      .updateTable('shipments')
      .set({ ...formColumns(form, updatedBy), updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toShipment(row);
  });
}
