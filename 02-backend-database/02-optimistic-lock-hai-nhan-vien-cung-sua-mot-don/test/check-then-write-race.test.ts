import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { ConcurrentModificationError, formOf, getShipment, type Shipment } from '../src/shared/shipment';
import { saveShipmentCheckThenWrite } from '../src/truoc/shipment.check-then-write';
import { saveShipment } from '../src/sau/shipment.repository';
import { createShipment, ensureVersionColumn, settle } from './helpers';

const db = createDb();

beforeAll(() => ensureVersionColumn(db));
afterAll(() => db.destroy());

type Save = typeof saveShipment;

/** Chạy `pairs` cặp lưu đồng thời từ cùng version; đếm cặp mà cả hai cùng được báo thành công. */
async function countBothSucceeded(save: Save, pairs: number): Promise<number> {
  let both = 0;
  for (let i = 0; i < pairs; i++) {
    const s: Shipment = await createShipment(db);
    const [ra, rb] = await Promise.all([
      settle(save(db, s.id, s.version, { ...formOf(s), address: `A-${i}` }, 'A')),
      settle(save(db, s.id, s.version, { ...formOf(s), note: `B-${i}` }, 'B')),
    ]);
    if (ra.ok && rb.ok) both++;
  }
  return both;
}

// Phép thử âm cho mục 3.4: cùng có cột version, nhưng kiểm tra nằm ngoài câu UPDATE thì pattern hỏng.
describe('so version trong code rồi mới UPDATE (cách làm sai)', () => {
  it('lưu lần lượt thì vẫn bắt được xung đột', async () => {
    const s = await createShipment(db);
    await saveShipmentCheckThenWrite(db, s.id, s.version, { ...formOf(s), address: 'A' }, 'A');
    const second = await settle(saveShipmentCheckThenWrite(db, s.id, s.version, { ...formOf(s), note: 'B' }, 'B'));
    expect((second as { error: unknown }).error).toBeInstanceOf(ConcurrentModificationError);
  });

  it('lưu đồng thời thì để lọt: có cặp cả hai cùng "thành công" và một thay đổi bị mất; kiểm tra trong WHERE thì không', async () => {
    const leakedCheckThenWrite = await countBothSucceeded(saveShipmentCheckThenWrite, 30);
    const leakedVersionInWhere = await countBothSucceeded(saveShipment, 30);
    expect(leakedCheckThenWrite).toBeGreaterThan(0);
    expect(leakedVersionInWhere).toBe(0);
  });

  it('khi cả hai cùng "thành công", trạng thái cuối chỉ còn thay đổi của một người', async () => {
    for (let i = 0; i < 30; i++) {
      const s = await createShipment(db);
      const [ra, rb] = await Promise.all([
        settle(saveShipmentCheckThenWrite(db, s.id, s.version, { ...formOf(s), address: 'Địa chỉ mới của A' }, 'A')),
        settle(saveShipmentCheckThenWrite(db, s.id, s.version, { ...formOf(s), note: 'Ghi chú của B' }, 'B')),
      ]);
      if (!(ra.ok && rb.ok)) continue;
      const final = (await getShipment(db, s.id))!;
      const kept = Number(final.address === 'Địa chỉ mới của A') + Number(final.note === 'Ghi chú của B');
      expect(kept).toBe(1);
      expect(final.version).toBe(s.version + 2); // version vẫn tăng hai lần, nên nhìn version không phát hiện được
      return;
    }
    throw new Error('30 cặp không có cặp nào lọt — khe hở không tái hiện được trên máy này');
  });
});
