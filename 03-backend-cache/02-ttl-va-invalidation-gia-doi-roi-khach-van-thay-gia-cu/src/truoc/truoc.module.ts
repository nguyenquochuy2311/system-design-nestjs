import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../shared/config';
import { KYSELY, type Database } from '../shared/db';
import { ShopMetrics } from '../shared/metrics';
import { PageRepository } from '../shared/page.repository';
import { PagesService } from '../shared/pages.service';
import { REDIS } from '../shared/redis.client';
import { TRUOC, type VariantHandlers } from '../shared/variant';
import { WATCH_LOG, type WatchLog } from '../shared/watch-log';
import { FixedTtlCache } from './fixed-ttl.cache';
import { adminSetPrice } from './price-writers';

function truocHandlers(config: AppConfig, db: Kysely<Database>, redis: Redis, repo: PageRepository, metrics: ShopMetrics, watch: WatchLog): VariantHandlers {
  const pages = new PagesService('truoc', new FixedTtlCache(redis, config.pageTtlS, metrics), repo, metrics, watch);
  return {
    pages,
    adminSetPrice: (id, price) => adminSetPrice(db, redis, id, price),
    // Bước đặt hàng của bản trước lấy giá từ trang chi tiết (qua cache): đúng giá khách đang thấy, kể cả khi đã cũ.
    placeOrder: async (productId, client) => {
      const { body } = await pages.product(productId, client);
      return body ? repo.insertOrder('truoc', productId, body.price) : undefined;
    },
  };
}

@Module({
  providers: [{ provide: TRUOC, inject: [APP_CONFIG, KYSELY, REDIS, PageRepository, ShopMetrics, WATCH_LOG], useFactory: truocHandlers }],
  exports: [TRUOC],
})
export class TruocModule {}
