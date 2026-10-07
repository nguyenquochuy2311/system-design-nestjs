import type { CustomerTier } from '../../src/sau/orders/domain/order';

/**
 * Bảng đặc tả quy tắc đặt hàng (chiết khấu + hạn mức), số kỳ vọng tính tay chứ không gọi lại code cần test.
 * Cùng một bảng chạy ở hai nơi:
 * - test/unit/order-rules.test.ts: qua PlaceOrderService với repository giả, không cần DB (bản "sau");
 * - test/e2e/web-order-rules.e2e.test.ts: qua HTTP + PostgreSQL, cách duy nhất test được bản "trước".
 */
export interface OrderRuleCase {
  name: string;
  tier: CustomerTier;
  creditLimit: number;
  /** Công nợ đang có (tổng đơn chưa thanh toán) trước khi đặt đơn này. */
  outstanding: number;
  products: { unitPrice: number; isPromo?: boolean }[];
  /** `product` là chỉ số trong `products`. */
  items: { product: number; quantity: number }[];
  expected:
    | { kind: 'placed'; subtotal: number; discount: number; total: number }
    | { kind: 'rejected'; error: 'credit_limit_exceeded'; shortfall: number };
}

const BIG = 10_000_000_000; // hạn mức đủ lớn để chỉ thử chiết khấu

export const ORDER_RULE_CASES: OrderRuleCase[] = [
  {
    name: 'hạng thường không được chiết khấu',
    tier: 'standard', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 2 }],
    expected: { kind: 'placed', subtotal: 2_000_000, discount: 0, total: 2_000_000 },
  },
  {
    name: 'hạng Bạc được 2%',
    tier: 'silver', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 3 }],
    expected: { kind: 'placed', subtotal: 3_000_000, discount: 60_000, total: 2_940_000 },
  },
  {
    name: 'hạng Vàng được 5%',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 4 }],
    expected: { kind: 'placed', subtotal: 4_000_000, discount: 200_000, total: 3_800_000 },
  },
  {
    name: 'hạng Kim cương được 8%',
    tier: 'diamond', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 5 }],
    expected: { kind: 'placed', subtotal: 5_000_000, discount: 400_000, total: 4_600_000 },
  },
  {
    name: 'hàng khuyến mãi không cộng chiết khấu hạng',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 2_000_000 }, { unitPrice: 3_000_000, isPromo: true }],
    items: [{ product: 0, quantity: 1 }, { product: 1, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 5_000_000, discount: 100_000, total: 4_900_000 },
  },
  {
    name: 'đơn toàn hàng khuyến mãi thì chiết khấu 0',
    tier: 'diamond', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_500_000, isPromo: true }], items: [{ product: 0, quantity: 2 }],
    expected: { kind: 'placed', subtotal: 3_000_000, discount: 0, total: 3_000_000 },
  },
  {
    name: 'đúng 50 triệu hàng được chiết khấu thì cộng thêm 1%',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 10_000_000 }], items: [{ product: 0, quantity: 5 }],
    expected: { kind: 'placed', subtotal: 50_000_000, discount: 3_000_000, total: 47_000_000 },
  },
  {
    name: 'thiếu 1 đồng tới 50 triệu thì không cộng, chiết khấu làm tròn xuống',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 49_999_999 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 49_999_999, discount: 2_499_999, total: 47_500_000 },
  },
  {
    name: 'hạng Bạc đơn lớn được 3%',
    tier: 'silver', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 20_000_000 }], items: [{ product: 0, quantity: 3 }],
    expected: { kind: 'placed', subtotal: 60_000_000, discount: 1_800_000, total: 58_200_000 },
  },
  {
    name: 'ngưỡng đơn lớn chỉ tính phần hàng được chiết khấu',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 40_000_000 }, { unitPrice: 20_000_000, isPromo: true }],
    items: [{ product: 0, quantity: 1 }, { product: 1, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 60_000_000, discount: 2_000_000, total: 58_000_000 },
  },
  {
    name: 'chiết khấu lẻ làm tròn xuống đồng',
    tier: 'silver', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 333 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 333, discount: 6, total: 327 },
  },
  {
    name: 'gộp hai dòng cùng sản phẩm',
    tier: 'gold', creditLimit: BIG, outstanding: 0,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 1 }, { product: 0, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 2_000_000, discount: 100_000, total: 1_900_000 },
  },
  {
    name: 'công nợ cộng đơn vừa đúng hạn mức thì được nhận',
    tier: 'standard', creditLimit: 10_000_000, outstanding: 6_000_000,
    products: [{ unitPrice: 4_000_000 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 4_000_000, discount: 0, total: 4_000_000 },
  },
  {
    name: 'vượt hạn mức 1 đồng thì bị từ chối',
    tier: 'standard', creditLimit: 10_000_000, outstanding: 6_000_000,
    products: [{ unitPrice: 4_000_001 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'rejected', error: 'credit_limit_exceeded', shortfall: 1 },
  },
  {
    name: 'công nợ đang có được cộng vào khi kiểm hạn mức',
    tier: 'gold', creditLimit: 100_000_000, outstanding: 80_000_000,
    products: [{ unitPrice: 1_000_000 }], items: [{ product: 0, quantity: 30 }],
    expected: { kind: 'rejected', error: 'credit_limit_exceeded', shortfall: 8_500_000 },
  },
  {
    name: 'hạn mức so với tổng tiền sau chiết khấu',
    tier: 'diamond', creditLimit: 9_200_000, outstanding: 0,
    products: [{ unitPrice: 10_000_000 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'placed', subtotal: 10_000_000, discount: 800_000, total: 9_200_000 },
  },
  {
    name: 'riêng giá trị đơn đã vượt hạn mức',
    tier: 'silver', creditLimit: 5_000_000, outstanding: 0,
    products: [{ unitPrice: 6_000_000 }], items: [{ product: 0, quantity: 1 }],
    expected: { kind: 'rejected', error: 'credit_limit_exceeded', shortfall: 880_000 },
  },
];
