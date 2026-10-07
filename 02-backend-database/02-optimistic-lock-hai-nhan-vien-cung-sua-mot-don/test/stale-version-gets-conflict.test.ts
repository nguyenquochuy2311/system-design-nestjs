import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { ConcurrentModificationError, formOf, getShipment, ShipmentNotFoundError } from '../src/shared/shipment';
import { saveShipment } from '../src/sau/shipment.repository';
import { mergeShipmentForm } from '../src/sau/merge-shipment-form';
import { createShipment, ensureVersionColumn, settle } from './helpers';

const db = createDb();

beforeAll(() => ensureVersionColumn(db));
afterAll(() => db.destroy());

describe('sau: Optimistic Offline Lock bằng cột version', () => {
  it('hai lần lưu từ cùng version: lần sau nhận ConcurrentModification, DB giữ thay đổi lần đầu', async () => {
    const created = await createShipment(db);
    const a = (await getShipment(db, created.id))!;
    const b = (await getShipment(db, created.id))!;

    await saveShipment(db, a.id, a.version, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3' }, 'A');
    const second = await settle(saveShipment(db, b.id, b.version, { ...formOf(b), note: 'Gọi trước 15 phút' }, 'B'));

    expect(second.ok).toBe(false);
    const err = (second as { error: unknown }).error;
    expect(err).toBeInstanceOf(ConcurrentModificationError);
    // Lỗi mang theo bản hiện tại để API trả 409 kèm dữ liệu cho màn hình gộp.
    expect((err as ConcurrentModificationError).current).toMatchObject({ address: '45 Hai Bà Trưng, Quận 3', version: a.version + 1, updatedBy: 'A' });

    const final = (await getShipment(db, created.id))!;
    expect(final.address).toBe('45 Hai Bà Trưng, Quận 3');
    expect(final.note).toBe('');
  });

  it('lưu với version mới nhất thành công và tăng version thêm đúng 1', async () => {
    const created = await createShipment(db);
    const first = await saveShipment(db, created.id, created.version, { ...formOf(created), note: 'lần 1' }, 'A');
    const second = await saveShipment(db, created.id, first.version, { ...formOf(first), note: 'lần 2' }, 'A');
    expect(first.version).toBe(created.version + 1);
    expect(second.version).toBe(created.version + 2);
    expect(second.note).toBe('lần 2');
  });

  it('vận đơn không tồn tại báo ShipmentNotFound (404), không báo xung đột (409)', async () => {
    const created = await createShipment(db);
    const result = await settle(saveShipment(db, 2_000_000_000, 1, formOf(created), 'A'));
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(ShipmentNotFoundError);
  });

  it('hai lần lưu thật sự đồng thời từ cùng version: luôn đúng một lần thành công (30 cặp)', async () => {
    for (let i = 0; i < 30; i++) {
      const s = await createShipment(db);
      const [ra, rb] = await Promise.all([
        settle(saveShipment(db, s.id, s.version, { ...formOf(s), address: `A-${i}` }, 'A')),
        settle(saveShipment(db, s.id, s.version, { ...formOf(s), note: `B-${i}` }, 'B')),
      ]);
      const winners = [ra, rb].filter((r) => r.ok);
      const losers = [ra, rb].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect((losers[0] as { error: unknown }).error).toBeInstanceOf(ConcurrentModificationError);
      expect((await getShipment(db, s.id))!.version).toBe(s.version + 1);
    }
  });

  it('sau 409, gộp ba phía rồi lưu với version mới: giữ địa chỉ của A và ghi chú của B', async () => {
    const created = await createShipment(db);
    const a = (await getShipment(db, created.id))!;
    const b = (await getShipment(db, created.id))!;
    await saveShipment(db, a.id, a.version, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3' }, 'A');

    const mineB = { ...formOf(b), note: 'Gọi trước 15 phút' };
    const rejected = await settle(saveShipment(db, b.id, b.version, mineB, 'B'));
    const { current } = (rejected as { error: ConcurrentModificationError }).error;

    const { merged, conflicts } = mergeShipmentForm(formOf(b), mineB, formOf(current));
    expect(conflicts).toEqual([]);
    const saved = await saveShipment(db, b.id, current.version, merged, 'B');
    expect(saved).toMatchObject({ address: '45 Hai Bà Trưng, Quận 3', note: 'Gọi trước 15 phút', version: b.version + 2 });
  });
});
