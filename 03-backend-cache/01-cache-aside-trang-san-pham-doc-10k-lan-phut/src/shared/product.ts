// Hợp đồng JSON của trang sản phẩm: bản "trước" và "sau" trả đúng cấu trúc này (mục 1: không đổi hợp đồng API).
export interface ProductVariant {
  id: number;
  sku: string;
  name: string;
  stock: number;
  price: number;
  listPrice: number;
}

export interface ProductPage {
  id: number;
  name: string;
  description: string;
  category: string;
  updatedAt: string;
  shop: { id: number; ratingAvg: number; ratingCount: number };
  variants: ProductVariant[];
  images: { url: string; position: number }[];
}

/** id trong URL: số nguyên dương trong miền integer của PostgreSQL; ngoài miền thì 400 thay vì lỗi SQL. */
export function parseProductId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= 2_147_483_647 ? id : null;
}

export interface PriceChange {
  variantId: number;
  price: number;
}

export function parsePriceChange(body: unknown): PriceChange | null {
  if (typeof body !== 'object' || body === null) return null;
  const { variantId, price } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(variantId) || (variantId as number) <= 0) return null;
  if (!Number.isSafeInteger(price) || (price as number) <= 0) return null;
  return { variantId: variantId as number, price: price as number };
}
