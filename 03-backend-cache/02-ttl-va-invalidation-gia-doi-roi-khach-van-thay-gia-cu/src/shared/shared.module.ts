import { Controller, Get, Global, Header, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { createDb, KYSELY, type Database } from './db';
import { ShopMetrics } from './metrics';
import { PageRepository } from './page.repository';
import { createRedis, REDIS } from './redis.client';
import { WATCH_LOG, WatchLog } from './watch-log';

@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(WATCH_LOG) private readonly watch: WatchLog,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() chờ Redis trả lời; khi Redis đang chết thì ngắt luôn, không chờ.
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
    await this.db.destroy();
    await this.watch.close();
  }
}

@Controller()
class OpsController {
  constructor(@Inject(ShopMetrics) private readonly metrics: ShopMetrics) {}

  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  /** Định dạng text của Prometheus; script đo đọc mỗi 10 giây. */
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  read(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

/** Hạ tầng dùng chung cho cả hai bản: cấu hình, Kysely, Redis, counter, repository, nhật ký đo. */
@Global()
@Module({
  controllers: [OpsController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    { provide: KYSELY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createDb(c.databaseUrl) },
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRedis(c.redisUrl, c.redisCommandTimeoutMs) },
    { provide: WATCH_LOG, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new WatchLog(c.watchIds, c.watchLog) },
    ShopMetrics,
    PageRepository,
    ConnectionCloser,
  ],
  exports: [APP_CONFIG, KYSELY, REDIS, WATCH_LOG, ShopMetrics, PageRepository],
})
export class SharedModule {}
