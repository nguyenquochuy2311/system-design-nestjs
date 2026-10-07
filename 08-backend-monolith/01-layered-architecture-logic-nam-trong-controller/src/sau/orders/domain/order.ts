// Lớp domain: kiểu dữ liệu và lỗi nghiệp vụ của đơn hàng. Không import NestJS, Kysely hay lớp nào khác
// (luật `domain-stays-pure` của dependency-cruiser kiểm điều này).

export type CustomerTier = 'standard' | 'silver' | 'gold' | 'diamond';
export type SalesChannel = 'web' | 'csv' | 'marketplace';

export interface OrderItemRequest {
  productId: number;
  quantity: number;
}

export interface CatalogProduct {
  id: number;
  unitPrice: number;
  isPromo: boolean;
}

export interface OrderLine {
  productId: number;
  quantity: number;
  unitPrice: number;
  isPromo: boolean;
}

/** Lỗi nghiệp vụ không mang mã HTTP: controller ánh xạ sang 404/422, job ghi vào báo cáo dòng lỗi. */
export class OrderRuleError extends Error {}

export class CustomerNotFoundError extends OrderRuleError {
  constructor(readonly customerId: number) {
    super(`Không tìm thấy khách hàng ${customerId}`);
  }
}

export class UnknownProductError extends OrderRuleError {
  constructor(readonly productIds: number[]) {
    super(`Không có sản phẩm: ${productIds.join(', ')}`);
  }
}

export class CreditLimitExceededError extends OrderRuleError {
  constructor(
    readonly customerId: number,
    readonly shortfall: number,
  ) {
    super(`Vượt hạn mức công nợ, còn thiếu ${shortfall} đồng`);
  }
}

/** Gộp các dòng trùng sản phẩm và gắn giá từ danh mục; thiếu sản phẩm nào thì báo đủ danh sách. */
export function buildOrderLines(items: readonly OrderItemRequest[], catalog: readonly CatalogProduct[]): OrderLine[] {
  const quantities = new Map<number, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const missing = [...quantities.keys()].filter((id) => !byId.has(id));
  if (missing.length > 0) throw new UnknownProductError(missing);
  return [...quantities].map(([productId, quantity]) => {
    const product = byId.get(productId) as CatalogProduct;
    return { productId, quantity, unitPrice: product.unitPrice, isPromo: product.isPromo };
  });
}
