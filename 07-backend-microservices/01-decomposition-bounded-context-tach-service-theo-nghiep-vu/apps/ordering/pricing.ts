export interface OrderItem {
  sku: string;
  quantity: number;
}

export interface ProductSnapshot {
  sku: string;
  productName: string;
  unitPriceVnd: number;
}

export type OrderLine = ProductSnapshot & { quantity: number };

export class UnknownProductError extends Error {
  constructor(readonly sku: string) {
    super(`Không có sản phẩm ${sku}`);
  }
}

/** Quy tắc của Ordering, chỉ dùng dữ liệu của Ordering: giá trên dòng hàng là giá đã chốt lúc mua. */
export function priceLines(items: OrderItem[], snapshots: Map<string, ProductSnapshot>): OrderLine[] {
  return items.map((item) => {
    const snapshot = snapshots.get(item.sku);
    if (!snapshot) {
      throw new UnknownProductError(item.sku);
    }
    return { ...snapshot, quantity: item.quantity };
  });
}

export function orderTotalVnd(lines: OrderLine[], percentOff: number): number {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceVnd * line.quantity, 0);
  return subtotal - Math.floor((subtotal * percentOff) / 100);
}
