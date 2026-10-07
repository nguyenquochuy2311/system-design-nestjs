import type { Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { ConcurrentModificationError, formOf, getShipment, ShipmentNotFoundError, type Shipment } from '../shared/shipment';
import { saveShipment } from './shipment.repository';

/**
 * Job nền đồng bộ giờ hẹn từ hãng vận chuyển. Nó cũng ghi qua `saveShipment` (kiểm tra version):
 * một đường ghi lách repository là đủ làm pattern mất tác dụng (mục 3.4).
 * Job ĐƯỢC tự thử lại vì thay đổi của nó (một trường lấy từ hãng) áp lại được lên bản mới nhất.
 * Form của người dùng thì KHÔNG tự thử lại: dữ liệu cũ trong form chính là thứ gây ghi đè.
 */
export async function syncAppointmentFromCarrier(
  db: Kysely<Database>,
  id: number,
  fetchAppointment: (shipment: Shipment) => Promise<string>,
  maxAttempts = 3,
): Promise<{ shipment: Shipment; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    const current = await getShipment(db, id);
    if (!current) throw new ShipmentNotFoundError(id);
    const appointmentAt = await fetchAppointment(current); // gọi API hãng, có thể mất vài giây
    try {
      const shipment = await saveShipment(db, id, current.version, { ...formOf(current), appointmentAt }, 'carrier-sync');
      return { shipment, attempts: attempt };
    } catch (err) {
      if (err instanceof ConcurrentModificationError && attempt < maxAttempts) continue; // đọc lại bản mới rồi áp lại
      throw err;
    }
  }
}
