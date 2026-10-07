import { randomInt } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ShopMetrics } from '../shared/metrics';
import { readJson, throttledWarn, type CacheLookup, type PageCache } from '../shared/page.cache';
import { cacheKeys } from '../shared/pages';

/**
 * Cache của bản sau: mỗi lần nạp trang, cùng một MULTI, ghi key trang vào chỉ mục ngược tag:product:<id> của mọi sản phẩm
 * trong trang, để worker biết phải xóa key nào khi giá đổi. TTL vẫn còn, nhưng chỉ là lưới an toàn khi sự kiện bị lỡ.
 */
export class TaggedPageCache implements PageCache {
  private readonly warn = throttledWarn(new Logger('sau.cache'));
  readonly minTtlS: number;
  readonly maxTtlS: number;
  /** Tag sống lâu hơn mọi key trang nó trỏ tới; mỗi lần SADD lại gia hạn. */
  readonly tagTtlS: number;

  constructor(
    private readonly redis: Redis,
    readonly baseTtlS: number,
    jitterPct: number,
    private readonly metrics: ShopMetrics,
  ) {
    // Tính bằng số nguyên: 900 * (1 + 10 / 100) trong số thực là 990,0000000000001, ceil thành 991.
    this.minTtlS = Math.floor((baseTtlS * (100 - jitterPct)) / 100);
    this.maxTtlS = Math.ceil((baseTtlS * (100 + jitterPct)) / 100);
    this.tagTtlS = this.maxTtlS + 60;
  }

  get<T>(key: string): Promise<CacheLookup<T>> {
    return readJson<T>(this.redis, key, (err) => this.fail('get', key, err));
  }

  async set(key: string, body: unknown, productIds: number[]): Promise<void> {
    // [PATTERN] TTL + jitter: 15 phút ± 10 % để các key nạp cùng lúc không cùng hết hạn
    const ttl = randomInt(this.minTtlS, this.maxTtlS + 1);
    const tx = this.redis.multi();
    tx.set(key, JSON.stringify(body), 'EX', ttl);
    for (const id of productIds) {
      // [PATTERN] chỉ mục ngược, cùng MULTI với SET: worker không thể chen giữa lúc có key mà chưa có tag
      tx.sadd(cacheKeys.tag('sau', id), key);
      tx.expire(cacheKeys.tag('sau', id), this.tagTtlS);
    }
    try {
      const failed = (await tx.exec())?.find(([err]) => err);
      if (failed) throw failed[0];
    } catch (err) {
      this.fail('set', key, err);
    }
  }

  private fail(op: 'get' | 'set', key: string, err: unknown): void {
    this.metrics.cacheErrors.inc({ variant: 'sau', op });
    this.warn(`Redis ${op} ${key} lỗi: ${(err as Error).message}; bỏ qua cache`);
  }
}
