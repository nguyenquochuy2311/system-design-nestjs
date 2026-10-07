// Dữ liệu catalog tất định, dùng chung cho API (NestJS), trang (Next.js generateStaticParams) và script sinh ảnh.
// Không có database: bài này đo header HTTP, không đo truy vấn; giá đổi được trong bộ nhớ qua route admin.

export interface Category {
  slug: string;
  name: string;
}

export const CATEGORIES: readonly Category[] = [
  { slug: 'dien-thoai', name: 'Điện thoại' },
  { slug: 'laptop', name: 'Laptop' },
  { slug: 'tai-nghe', name: 'Tai nghe' },
  { slug: 'dong-ho', name: 'Đồng hồ thông minh' },
];

export const PRODUCTS_PER_CATEGORY = 24;
export const PRODUCT_COUNT = CATEGORIES.length * PRODUCTS_PER_CATEGORY;
export const IMAGE_SIZES = { thumb: 480, large: 1200 } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;
/** Phiên bản ảnh nằm trong URL: ảnh đổi thì URL đổi, nên max-age dài của ảnh không giữ bản cũ (chi tiết ở bài 02). */
export const IMAGE_VERSION = 1;

export const productIds = (): number[] => Array.from({ length: PRODUCT_COUNT }, (_, i) => i + 1);

export function categoryOf(id: number): Category {
  const c = CATEGORIES[Math.floor((id - 1) / PRODUCTS_PER_CATEGORY)];
  if (!c) throw new Error(`sản phẩm ${id} nằm ngoài catalog`);
  return c;
}

export const initialPrice = (id: number): number => 1_000_000 + ((id * 7919) % 300) * 100_000;

/** Màu chủ đạo của ảnh sản phẩm (0–359), để ảnh mỗi sản phẩm khác nhau nhưng sinh lại vẫn giống hệt. */
export const productHue = (id: number): number => (id * 47) % 360;

/** JSON mà API trả cho một sản phẩm (trang Next.js đọc đúng hình dạng này). */
export interface ProductJson {
  id: number;
  name: string;
  category: string;
  price: number;
  currency: 'VND';
  images: { thumb: string; large: string };
}

export interface CartSummaryJson {
  userId: number;
  count: number;
  total: number;
}
