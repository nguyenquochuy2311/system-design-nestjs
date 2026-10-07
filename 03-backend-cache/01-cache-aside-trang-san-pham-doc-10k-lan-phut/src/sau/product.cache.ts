import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CatalogMetrics } from '../shared/metrics';
import type { ProductPage } from '../shared/product';
import { REDIS } from '../shared/redis.client';

/** Tiền tố có phiên bản: đổi cấu trúc JSON thì tăng v1 → v2, bản deploy mới không đọc nhầm dữ liệu cũ. */
export const KEY_PREFIX = 'product:v1:';
export const PRODUCT_TTL_SECONDS = 600;
export const PRODUCT_TTL_JITTER_SECONDS = 60;
export const NOT_FOUND_TTL_SECONDS = 30;
/** Giá trị đánh dấu "id này không tồn tại" (negative cache); JSON của sản phẩm không bao giờ trùng chuỗi này. */
export const NOT_FOUND_MARKER = '{"notFound":true}';

export type CacheLookup = { kind: 'hit'; page: ProductPage } | { kind: 'negative-hit' } | { kind: 'miss' } | { kind: 'error' };

/** Đọc/ghi/xóa key sản phẩm trên Redis. Không bao giờ ném lỗi ra ngoài: cache hỏng chỉ được làm chậm, không làm sập trang. */
@Injectable()
export class ProductCache {
  private readonly logger = new Logger(ProductCache.name);
  private lastWarnAt = 0;
  private suppressedWarns = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CatalogMetrics) private readonly metrics: CatalogMetrics,
  ) {}

  static key(id: number): string {
    return `${KEY_PREFIX}${id}`;
  }

  async get(id: number): Promise<CacheLookup> {
    try {
      const raw = await this.redis.get(ProductCache.key(id));
      if (raw === null) return { kind: 'miss' };
      if (raw === NOT_FOUND_MARKER) return { kind: 'negative-hit' };
      return { kind: 'hit', page: JSON.parse(raw) as ProductPage };
    } catch (err) {
      // [PATTERN] Redis lỗi, timeout hoặc giá trị hỏng: báo "error" để service đọc DB (fail open)
      this.warn('get', id, err);
      return { kind: 'error' };
    }
  }

  /** page = null: ghi nhớ "không tồn tại" 30 giây, chặn bot quét id rỗng xuyên xuống DB. */
  async set(id: number, page: ProductPage | null): Promise<void> {
    // [PATTERN] luôn có TTL; jitter 0–60 s để các key nạp cùng lúc không hết hạn cùng lúc
    const ttl = page ? PRODUCT_TTL_SECONDS + randomInt(0, PRODUCT_TTL_JITTER_SECONDS + 1) : NOT_FOUND_TTL_SECONDS;
    try {
      await this.redis.set(ProductCache.key(id), page ? JSON.stringify(page) : NOT_FOUND_MARKER, 'EX', ttl);
    } catch (err) {
      this.warn('set', id, err);
    }
  }

  async invalidate(id: number): Promise<void> {
    try {
      await this.redis.del(ProductCache.key(id));
    } catch (err) {
      // Xóa hụt nghĩa là khách có thể thấy giá cũ tới hết TTL: log mọi lần, không gộp (đường ghi hiếm).
      this.metrics.cacheErrors.inc({ op: 'del' });
      this.logger.error(`không xóa được ${ProductCache.key(id)} sau khi sửa: ${(err as Error).message}; giá cũ có thể còn tới hết TTL`);
    }
  }

  /** Lỗi đọc/ghi cache: đếm mọi lần, nhưng in tối đa một dòng mỗi 5 giây để lúc Redis chết log không ngập. */
  private warn(op: 'get' | 'set', id: number, err: unknown): void {
    this.metrics.cacheErrors.inc({ op });
    const now = Date.now();
    if (now - this.lastWarnAt < 5_000) {
      this.suppressedWarns++;
      return;
    }
    const extra = this.suppressedWarns ? ` (và ${this.suppressedWarns} lỗi khác trong 5 giây trước)` : '';
    this.logger.warn(`Redis ${op} ${ProductCache.key(id)} lỗi: ${(err as Error).message}; bỏ qua cache, đọc DB${extra}`);
    this.lastWarnAt = now;
    this.suppressedWarns = 0;
  }
}
