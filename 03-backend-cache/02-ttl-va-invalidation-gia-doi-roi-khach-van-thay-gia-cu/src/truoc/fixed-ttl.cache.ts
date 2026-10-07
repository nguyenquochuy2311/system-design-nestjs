import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ShopMetrics } from '../shared/metrics';
import { readJson, throttledWarn, type CacheLookup, type PageCache } from '../shared/page.cache';

/**
 * Cache của bản trước (Cache-Aside bài 01, TTL 15 phút): TTL cố định, không ghi lại trang nào chứa sản phẩm nào.
 * Vì vậy khi giá đổi, ngoài key chi tiết mà admin tự xóa, không ai biết phải xóa key danh mục hay trang chủ nào.
 */
export class FixedTtlCache implements PageCache {
  private readonly warn = throttledWarn(new Logger('truoc.cache'));

  constructor(
    private readonly redis: Redis,
    private readonly ttlS: number,
    private readonly metrics: ShopMetrics,
  ) {}

  get<T>(key: string): Promise<CacheLookup<T>> {
    return readJson<T>(this.redis, key, (err) => this.fail('get', key, err));
  }

  async set(key: string, body: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(body), 'EX', this.ttlS); // mọi key cùng TTL, không jitter
    } catch (err) {
      this.fail('set', key, err);
    }
  }

  private fail(op: 'get' | 'set', key: string, err: unknown): void {
    this.metrics.cacheErrors.inc({ variant: 'truoc', op });
    this.warn(`Redis ${op} ${key} lỗi: ${(err as Error).message}; bỏ qua cache`);
  }
}
