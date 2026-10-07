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
 * CÁCH LÀM SAI HAY GẶP (mục 3.4): có cột version nhưng so version trong code, rồi mới UPDATE theo id.
 * Lưu lần lượt thì bắt được xung đột; nhưng giữa SELECT và UPDATE có một khe thời gian, hai request
 * cùng version gửi gần như đồng thời đều qua được phép so và cả hai cùng ghi => lost update quay lại.
 */
export async function saveShipmentCheckThenWrite(
  db: Kysely<Database>,
  id: number,
  expectedVersion: number,
  form: ShipmentForm,
  updatedBy: string,
): Promise<Shipment> {
  const current = await getShipment(db, id);
  if (!current) throw new ShipmentNotFoundError(id);
  if (current.version !== expectedVersion) throw new ConcurrentModificationError(current, expectedVersion);
  // Khe hở: người khác có thể commit đúng lúc này. WHERE chỉ có id nên không phát hiện được.
  const row = await db
    .updateTable('shipments')
    .set({ ...formColumns(form, updatedBy), updated_at: sql`now()`, version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return toShipment(row);
}
