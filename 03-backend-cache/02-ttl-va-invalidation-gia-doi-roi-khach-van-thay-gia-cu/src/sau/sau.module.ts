import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../shared/config';
import { KYSELY, type Database } from '../shared/db';
import { ShopMetrics } from '../shared/metrics';
import { PageRepository } from '../shared/page.repository';
import { PagesService } from '../shared/pages.service';
import { REDIS } from '../shared/redis.client';
import { SAU, type VariantHandlers } from '../shared/variant';
import { WATCH_LOG, type WatchLog } from '../shared/watch-log';
import { adminSetPrice } from './price-writers';
import { TaggedPageCache } from './tagged.cache';

function sauHandlers(config: AppConfig, db: Kysely<Database>, redis: Redis, repo: PageRepository, metrics: ShopMetrics, watch: WatchLog): VariantHandlers {
  const pages = new PagesService('sau', new TaggedPageCache(redis, config.pageTtlS, config.pageTtlJitterPct, metrics), repo, metrics, watch);
  return {
    pages,
    adminSetPrice: (id, price) => adminSetPrice(db, id, price),
    // Ràng buộc mục 1: bước đặt hàng luôn tính lại giá từ DB, không dùng giá trong cache dù cache có thể cũ vài trăm ms.
    placeOrder: (productId) => repo.insertOrder('sau', productId, null),
  };
}

@Module({
  providers: [{ provide: SAU, inject: [APP_CONFIG, KYSELY, REDIS, PageRepository, ShopMetrics, WATCH_LOG], useFactory: sauHandlers }],
  exports: [SAU],
})
export class SauModule {}
