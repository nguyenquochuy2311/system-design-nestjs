import type { CustomerTier, OrderLine } from './order';

// [PATTERN] Quy tắc chiết khấu nằm đúng một chỗ, là hàm thuần: không biết HTTP, CSV hay SQL.
// Web, job CSV và job đồng bộ sàn đều đi qua PlaceOrderService nên đổi ở đây là cả ba đổi theo.

/** Chiết khấu theo hạng khách, tính bằng phần vạn (basis point) để cộng trừ bằng số nguyên. */
export const TIER_DISCOUNT_BPS: Record<CustomerTier, number> = {
  standard: 0,
  silver: 200,
  gold: 500,
  diamond: 800,
};

/** Phần hàng được chiết khấu từ 50 triệu đồng trở lên được cộng thêm 1%. */
export const LARGE_ORDER_THRESHOLD = 50_000_000;
export const LARGE_ORDER_BONUS_BPS = 100;

export interface OrderPricing {
  subtotal: number;
  discount: number;
  total: number;
}

export function priceOrder(tier: CustomerTier, lines: readonly OrderLine[]): OrderPricing {
  let subtotal = 0;
  let discountable = 0;
  for (const line of lines) {
    const lineTotal = line.unitPrice * line.quantity;
    subtotal += lineTotal;
    // Hàng khuyến mãi đã giảm giá sẵn, không cộng chiết khấu hạng.
    if (!line.isPromo) discountable += lineTotal;
  }
  const bonusBps = discountable >= LARGE_ORDER_THRESHOLD ? LARGE_ORDER_BONUS_BPS : 0;
  const discount = Math.floor((discountable * (TIER_DISCOUNT_BPS[tier] + bonusBps)) / 10_000);
  return { subtotal, discount, total: subtotal - discount };
}
