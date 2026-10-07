import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { createDb, KYSELY, type Database } from './db';
import { CatalogMetrics } from './metrics';
import { OpsController } from './ops.controller';
import { ProductRepository } from './product.repository';
import { createRedis, REDIS } from './redis.client';

@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() chờ Redis trả lời; khi Redis đang chết thì ngắt luôn, không chờ.
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
    await this.db.destroy();
  }
}

/** Hạ tầng dùng chung cho cả hai bản: cấu hình, Kysely, Redis, counter và repository (không biết gì về cache). */
@Global()
@Module({
  controllers: [OpsController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    { provide: KYSELY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createDb(c.databaseUrl) },
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRedis(c.redisUrl, c.redisCommandTimeoutMs) },
    CatalogMetrics,
    ProductRepository,
    ConnectionCloser,
  ],
  exports: [APP_CONFIG, KYSELY, REDIS, CatalogMetrics, ProductRepository],
})
export class SharedModule {}
