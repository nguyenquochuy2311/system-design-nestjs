import { Module } from '@nestjs/common';
import { CleanupExpiredKeysJob } from './idempotency/cleanup-expired-keys.job';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { IDEMPOTENCY_OPTIONS, optionsFromEnv } from './idempotency/idempotency.options';
import { IdempotencyRepository } from './idempotency/idempotency.repository';
import { SauPaymentsController } from './payments.controller';

@Module({
  controllers: [SauPaymentsController],
  providers: [
    { provide: IDEMPOTENCY_OPTIONS, useFactory: () => optionsFromEnv() },
    IdempotencyRepository,
    IdempotencyInterceptor,
    CleanupExpiredKeysJob,
  ],
})
export class SauModule {}
