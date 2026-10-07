import { Global, Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Kysely } from 'kysely';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { createDb, KYSELY, type Database } from './db';
import { createS3Client, ensureBucket, OBJECT_STORAGE, S3ObjectStorage } from './object-storage';

const S3_CLIENT = Symbol('S3_CLIENT');

@Injectable()
class InfraLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureBucket(this.s3, this.config.s3.bucket); // idempotent, web và worker đều gọi được
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
    this.s3.destroy();
  }
}

/** Hạ tầng dùng chung cho cả hai process type (web, worker): cấu hình, Kysely, object storage. */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    { provide: KYSELY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createDb(c.databaseUrl) },
    { provide: S3_CLIENT, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createS3Client(c.s3) },
    { provide: OBJECT_STORAGE, inject: [S3_CLIENT, APP_CONFIG], useFactory: (s3: S3Client, c: AppConfig) => new S3ObjectStorage(s3, c.s3.bucket) },
    InfraLifecycle,
  ],
  exports: [APP_CONFIG, KYSELY, OBJECT_STORAGE],
})
export class SharedModule {}
