import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { formOf, getShipment } from '../src/shared/shipment';
import { saveShipmentLastWriteWins } from '../src/truoc/shipment.last-write-wins';
import { saveShipmentSelectForUpdate } from '../src/truoc/shipment.select-for-update';
import { saveShipment } from '../src/sau/shipment.repository';
import { createShipment, ensureVersionColumn } from './helpers';

const db = createDb();

beforeAll(() => ensureVersionColumn(db));
afterAll(() => db.destroy());

describe('trước: lost update khi hai nhân viên cùng sửa một vận đơn', () => {
  it('người lưu sau xóa mất địa chỉ người lưu trước vừa sửa, và không ai được báo', async () => {
    const created = await createShipment(db);
    // 9h00: A và B cùng mở form, cùng thấy địa chỉ cũ.
    const a = (await getShipment(db, created.id))!;
    const b = (await getShipment(db, created.id))!;

    // 9h02: A đổi địa chỉ. 9h05: B chỉ thêm ghi chú, nhưng form B vẫn chứa địa chỉ cũ.
    await saveShipmentLastWriteWins(db, a.id, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3' }, 'A');
    const savedB = await saveShipmentLastWriteWins(db, b.id, { ...formOf(b), note: 'Gọi trước 15 phút' }, 'B');

    const final = (await getShipment(db, created.id))!;
    expect(savedB.note).toBe('Gọi trước 15 phút');
    expect(final.address).toBe('12 Lê Lợi, Quận 1'); // thay đổi của A đã mất
  });

  it('SELECT ... FOR UPDATE trong request lưu không cứu được: form đọc từ request trước vẫn ghi đè', async () => {
    const created = await createShipment(db);
    const a = (await getShipment(db, created.id))!;
    const b = (await getShipment(db, created.id))!;

    await saveShipmentSelectForUpdate(db, a.id, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3' }, 'A');
    await saveShipmentSelectForUpdate(db, b.id, { ...formOf(b), note: 'Gọi trước 15 phút' }, 'B');

    const final = (await getShipment(db, created.id))!;
    expect(final.address).toBe('12 Lê Lợi, Quận 1');
  });

  it('một đường ghi lách repository (không tăng version) làm form giữ version cũ không bị chặn', async () => {
    const created = await createShipment(db);
    const b = (await getShipment(db, created.id))!;

    // Script sửa dữ liệu cũ ghi thẳng bằng UPDATE ... WHERE id, không tăng version.
    const script = await saveShipmentLastWriteWins(db, created.id, { ...formOf(created), codCents: 500_000 }, 'script');
    expect(script.version).toBe(b.version);

    // B lưu với version vẫn "đúng" nên qua được kiểm tra, xóa mất tiền thu hộ script vừa sửa.
    await saveShipment(db, b.id, b.version, { ...formOf(b), note: 'Khách hẹn chiều' }, 'B');
    const final = (await getShipment(db, created.id))!;
    expect(final.codCents).toBe(350_000);
  });
});
