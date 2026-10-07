import { SetMetadata } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * [PATTERN] Bảng chính sách cache theo loại tài nguyên (RFC 9111). Một chỗ duy nhất quyết định response nào được lưu,
 * lưu ở đâu (trình duyệt hay cả CDN) và bao lâu; route chỉ khai báo mình thuộc loại nào.
 */
export const CACHE_POLICIES = {
  /** File băm tên của Next (/_next/static): Next tự đặt, ghi ở đây cho đủ bảng. Tên đổi khi nội dung đổi (bài 02). */
  'immutable-asset': 'public, max-age=31536000, immutable',
  /** Ảnh sản phẩm: trình duyệt giữ 1 ngày, CDN 7 ngày; URL có ?v= nên ảnh đổi thì URL đổi. */
  media: 'public, max-age=86400, s-maxage=604800',
  /** JSON công khai (danh sách, sản phẩm): trình duyệt hết hạn ngay nên lần sau hỏi lại bằng If-None-Match; CDN giữ
   *  60 giây, đúng ràng buộc "giá mới trong vòng 1 phút". */
  'public-json': 'public, max-age=0, s-maxage=60',
  /** Dữ liệu riêng của khách: không cache dùng chung nào được lưu, trình duyệt cũng không lưu xuống đĩa. */
  private: 'private, no-store',
  /** Mặc định an toàn cho mọi thứ còn lại (ghi, lỗi, vận hành). */
  'no-store': 'no-store',
} as const;

export type CachePolicyName = keyof typeof CACHE_POLICIES;
export const CACHE_POLICY_KEY = 'http-cache:policy';

/** Khai báo loại tài nguyên của route (handler hoặc cả controller). Không khai báo = no-store. */
export const CachePolicy = (name: CachePolicyName) => SetMetadata(CACHE_POLICY_KEY, name);

/** Chính sách cho phép cache dùng chung (CDN) lưu response. */
export const isShared = (name: CachePolicyName): boolean => /\bpublic\b/.test(CACHE_POLICIES[name]);

/**
 * [PATTERN] ETag yếu từ hash nội dung: cùng nội dung thì cùng ETag trên mọi instance (không dùng thời gian sửa file
 * hay id tiến trình), nội dung đổi thì ETag đổi. "Yếu" (W/) vì chỉ hứa tương đương về nghĩa, đủ cho If-None-Match.
 */
export function etagFor(content: string | Buffer): string {
  return `W/"${createHash('sha256').update(content).digest('base64url').slice(0, 27)}"`;
}
