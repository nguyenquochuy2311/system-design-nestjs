import { Controller, Get, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type Redis from 'ioredis';
import { createDb, KYSELY, type Database } from './db';
import { createRedis, REDIS } from './redis';

@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
    this.redis.disconnect();
  }
}

@Controller('healthz')
class HealthController {
  @Get()
  ok() {
    return { ok: true };
  }
}

/** Hạ tầng dùng chung cho hai bản: Kysely và ioredis. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: KYSELY, useFactory: () => createDb() },
    { provide: REDIS, useFactory: () => createRedis() },
    ConnectionCloser,
  ],
  exports: [KYSELY, REDIS],
})
export class SharedModule {}
