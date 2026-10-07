// Hợp đồng JSON của ba loại trang có chứa giá, tên key cache và phần kiểm tra tham số dùng chung cho hai bản.
export type Variant = 'truoc' | 'sau';
export const VARIANTS: readonly Variant[] = ['truoc', 'sau'];
export type PageKind = 'product' | 'category' | 'home';

export interface ProductItem {
  id: number;
  name: string;
  category: string;
  price: number;
  listPrice: number;
}
export type ProductPage = ProductItem;
export interface CategoryPage {
  category: string;
  page: number;
  items: ProductItem[];
}
export interface HomeDeals {
  items: ProductItem[];
}

export const PAGE_SIZE = 20;
export const HOME_DEALS_LIMIT = 12;

/** Key có tiền tố bản (truoc/sau) vì hai bản chạy chung một Redis; v1 để đổi cấu trúc JSON khi deploy (bài 03/01). */
export const cacheKeys = {
  product: (v: Variant, id: number) => `${v}:product:v1:${id}`,
  category: (v: Variant, slug: string, page: number) => `${v}:category:v1:${slug}:p${page}`,
  home: (v: Variant) => `${v}:home:v1:deals`,
  /** [PATTERN] chỉ mục ngược: Set các key trang có chứa sản phẩm id (chỉ bản sau ghi). */
  tag: (v: Variant, id: number) => `${v}:tag:product:${id}`,
};

export const isVariant = (v: string): v is Variant => (VARIANTS as readonly string[]).includes(v);

/** id trong URL: số nguyên dương trong miền integer của PostgreSQL; ngoài miền thì 400 thay vì lỗi SQL. */
export function parseId(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : raw;
  if (typeof s !== 'string' || !/^\d{1,10}$/.test(s)) return null;
  const id = Number(s);
  return id >= 1 && id <= 2_147_483_647 ? id : null;
}

export function parsePage(raw: unknown): number | null {
  if (raw === undefined) return 1;
  const page = parseId(raw);
  return page !== null && page <= 10_000 ? page : null;
}

export const parseSlug = (raw: string): string | null => (/^[a-z0-9-]{1,40}$/.test(raw) ? raw : null);

export function parsePrice(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { price } = body as Record<string, unknown>;
  return Number.isSafeInteger(price) && (price as number) > 0 ? (price as number) : null;
}
