import { describe, expect, it } from 'vitest';
import type { ShipmentForm } from '../src/shared/shipment';
import { mergeShipmentForm } from '../src/sau/merge-shipment-form';

const base: ShipmentForm = {
  recipientName: 'Chị Lan',
  address: '12 Lê Lợi, Quận 1',
  appointmentAt: '2026-10-08T02:00:00.000Z',
  codCents: 350_000,
  note: '',
};

describe('gộp ba phía sau 409 (logic của màn hình gộp)', () => {
  it('trường chỉ một phía sửa được gộp sẵn, không hỏi người dùng', () => {
    const theirs = { ...base, address: '45 Hai Bà Trưng, Quận 3' };
    const mine = { ...base, note: 'Gọi trước 15 phút' };
    expect(mergeShipmentForm(base, mine, theirs)).toEqual({
      merged: { ...base, address: '45 Hai Bà Trưng, Quận 3', note: 'Gọi trước 15 phút' },
      conflicts: [],
    });
  });

  it('cùng một trường hai phía sửa khác nhau là xung đột; tạm giữ bản hiện tại chờ người dùng chọn', () => {
    const theirs = { ...base, codCents: 400_000 };
    const mine = { ...base, codCents: 0, note: 'Shop báo miễn thu hộ' };
    const { merged, conflicts } = mergeShipmentForm(base, mine, theirs);
    expect(conflicts).toEqual([{ field: 'codCents', base: 350_000, mine: 0, theirs: 400_000 }]);
    expect(merged).toEqual({ ...base, codCents: 400_000, note: 'Shop báo miễn thu hộ' });
  });

  it('hai phía sửa cùng một giá trị thì không phải xung đột', () => {
    const same = { ...base, address: '45 Hai Bà Trưng, Quận 3' };
    expect(mergeShipmentForm(base, same, same).conflicts).toEqual([]);
  });
});
