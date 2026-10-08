import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { AttackerController } from './attacker.controller';
import { CONFIG, configFromEnv, type AppConfig } from './config';
import { createPool, DB } from './db';
import { createRedis, REDIS } from './redis';
import { NotesService } from './notes.service';
import { UsersService } from './users.service';

@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.end();
    this.redis.disconnect();
  }
}

/** Hạ tầng dùng chung cho hai bản: config, pg pool, ioredis, user/note repo, endpoint kẻ tấn công giả. */
@Global()
@Module({
  controllers: [AttackerController],
  providers: [
    { provide: CONFIG, useFactory: configFromEnv },
    { provide: DB, useFactory: (cfg: AppConfig) => createPool({ connectionString: cfg.databaseUrl }), inject: [CONFIG] },
    { provide: REDIS, useFactory: (cfg: AppConfig) => createRedis(cfg.redisUrl), inject: [CONFIG] },
    UsersService,
    NotesService,
    ConnectionCloser,
  ],
  exports: [CONFIG, DB, REDIS, UsersService, NotesService],
})
export class SharedModule {}
