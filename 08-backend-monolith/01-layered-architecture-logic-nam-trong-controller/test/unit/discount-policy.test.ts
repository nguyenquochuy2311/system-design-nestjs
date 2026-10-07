import { describe, expect, it } from 'vitest';
import { priceOrder } from '../../src/sau/orders/domain/discount-policy';
import { buildOrderLines, UnknownProductError } from '../../src/sau/orders/domain/order';

const line = (unitPrice: number, quantity = 1, isPromo = false) => ({ productId: 1, quantity, unitPrice, isPromo });

describe('DiscountPolicy: hàm thuần, test không cần mock', () => {
  it('chiết khấu theo hạng: thường 0%, Bạc 2%, Vàng 5%, Kim cương 8%', () => {
    expect(priceOrder('standard', [line(1_000_000)]).discount).toBe(0);
    expect(priceOrder('silver', [line(1_000_000)]).discount).toBe(20_000);
    expect(priceOrder('gold', [line(1_000_000)]).discount).toBe(50_000);
    expect(priceOrder('diamond', [line(1_000_000)]).discount).toBe(80_000);
  });

  it('hàng khuyến mãi tính vào tổng tiền nhưng không được chiết khấu hạng', () => {
    expect(priceOrder('gold', [line(2_000_000), line(3_000_000, 1, true)])).toEqual({
      subtotal: 5_000_000,
      discount: 100_000,
      total: 4_900_000,
    });
  });

  it('từ 50 triệu hàng được chiết khấu thì cộng thêm 1%, thiếu 1 đồng thì không', () => {
    expect(priceOrder('gold', [line(50_000_000)]).discount).toBe(3_000_000);
    expect(priceOrder('gold', [line(49_999_999)]).discount).toBe(2_499_999);
  });

  it('chiết khấu làm tròn xuống đồng', () => {
    expect(priceOrder('silver', [line(333)])).toEqual({ subtotal: 333, discount: 6, total: 327 });
  });
});

describe('buildOrderLines', () => {
  it('gộp dòng trùng sản phẩm và gắn giá từ danh mục', () => {
    const lines = buildOrderLines(
      [{ productId: 7, quantity: 1 }, { productId: 7, quantity: 2 }],
      [{ id: 7, unitPrice: 1_000, isPromo: false }],
    );
    expect(lines).toEqual([{ productId: 7, quantity: 3, unitPrice: 1_000, isPromo: false }]);
  });

  it('báo đủ danh sách sản phẩm không có trong danh mục', () => {
    expect(() => buildOrderLines([{ productId: 8, quantity: 1 }, { productId: 9, quantity: 1 }], [])).toThrow(
      new UnknownProductError([8, 9]),
    );
  });
});
