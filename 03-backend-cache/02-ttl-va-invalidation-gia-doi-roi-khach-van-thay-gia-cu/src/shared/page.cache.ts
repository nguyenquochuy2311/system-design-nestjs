import type { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

export type CacheLookup<T> = { kind: 'hit'; body: T } | { kind: 'miss' } | { kind: 'error' };

/**
 * Cache trang. Bản trước: TTL cố định, không chỉ mục. Bản sau: TTL có jitter và ghi chỉ mục ngược theo sản phẩm.
 * Không bao giờ ném lỗi ra ngoài: cache hỏng chỉ được làm chậm, không làm sập trang (bài 03/01).
 */
export interface PageCache {
  get<T>(key: string): Promise<CacheLookup<T>>;
  /** productIds: các sản phẩm có giá nằm trong trang, để bản sau biết key nào phải xóa khi giá của chúng đổi. */
  set(key: string, body: unknown, productIds: number[]): Promise<void>;
}

/** GET + JSON.parse, lỗi Redis hay giá trị hỏng đều thành 'error' để service đọc DB (fail open). */
export async function readJson<T>(redis: Redis, key: string, onError: (err: unknown) => void): Promise<CacheLookup<T>> {
  try {
    const raw = await redis.get(key);
    return raw === null ? { kind: 'miss' } : { kind: 'hit', body: JSON.parse(raw) as T };
  } catch (err) {
    onError(err);
    return { kind: 'error' };
  }
}

/** Log lỗi cache tối đa một dòng mỗi 5 giây kèm số lỗi bị gộp, để lúc Redis chết log không ngập (bài 03/01). */
export function throttledWarn(logger: Logger): (message: string) => void {
  let lastAt = 0;
  let suppressed = 0;
  return (message) => {
    const now = Date.now();
    if (now - lastAt < 5_000) {
      suppressed++;
      return;
    }
    logger.warn(suppressed ? `${message} (và ${suppressed} lỗi khác trong 5 giây trước)` : message);
    lastAt = now;
    suppressed = 0;
  };
}
