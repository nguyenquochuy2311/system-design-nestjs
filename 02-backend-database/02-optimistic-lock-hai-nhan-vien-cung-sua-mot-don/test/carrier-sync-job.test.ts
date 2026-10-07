import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { ConcurrentModificationError, formOf, getShipment } from '../src/shared/shipment';
import { saveShipment } from '../src/sau/shipment.repository';
import { syncAppointmentFromCarrier } from '../src/sau/carrier-sync.job';
import { createShipment, ensureVersionColumn, settle } from './helpers';

const db = createDb();

beforeAll(() => ensureVersionColumn(db));
afterAll(() => db.destroy());

const CARRIER_APPOINTMENT = '2026-10-09T03:30:00.000Z';

describe('job nền đồng bộ giờ hẹn cũng bị kiểm tra version', () => {
  it('nhân viên đổi địa chỉ trong lúc job gọi hãng: job bị từ chối, đọc lại, áp lại; địa chỉ mới không mất', async () => {
    const created = await createShipment(db);
    let calls = 0;
    const { shipment, attempts } = await syncAppointmentFromCarrier(db, created.id, async (seen) => {
      calls++;
      if (calls === 1) {
        // Trong lúc job chờ API hãng, nhân viên A lưu địa chỉ mới.
        await saveShipment(db, seen.id, seen.version, { ...formOf(seen), address: '45 Hai Bà Trưng, Quận 3' }, 'A');
      }
      return CARRIER_APPOINTMENT;
    });

    expect(attempts).toBe(2);
    expect(shipment).toMatchObject({ address: '45 Hai Bà Trưng, Quận 3', appointmentAt: CARRIER_APPOINTMENT, updatedBy: 'carrier-sync' });
    expect(shipment.version).toBe(created.version + 2);
  });

  it('bị chen ngang mọi lần: job dừng sau số lần thử tối đa và báo lỗi, không ghi đè', async () => {
    const created = await createShipment(db);
    let n = 0;
    const result = await settle(
      syncAppointmentFromCarrier(
        db,
        created.id,
        async (seen) => {
          n++;
          await saveShipment(db, seen.id, seen.version, { ...formOf(seen), note: `sửa lần ${n}` }, 'A');
          return CARRIER_APPOINTMENT;
        },
        3,
      ),
    );

    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(ConcurrentModificationError);
    const final = (await getShipment(db, created.id))!;
    expect(final.note).toBe('sửa lần 3');
    expect(final.appointmentAt).toBe(created.appointmentAt);
  });
});
