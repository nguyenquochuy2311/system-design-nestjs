import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { IdempotencyRepository } from './idempotency.repository';
import { IDEMPOTENCY_OPTIONS, type IdempotencyOptions } from './idempotency.options';

/**
 * Job dọn khóa quá hạn lưu giữ. Xóa theo lô nhỏ để không giữ khóa dòng lâu trên bảng đang nhận ghi.
 * Chạy trong tiến trình API khi `cleanupIntervalMs > 0`, hoặc theo lịch bên ngoài bằng `pnpm job:cleanup`.
 */
@Injectable()
export class CleanupExpiredKeysJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupExpiredKeysJob.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(IdempotencyRepository) private readonly keys: IdempotencyRepository,
    @Inject(IDEMPOTENCY_OPTIONS) private readonly options: IdempotencyOptions,
  ) {}

  async run(batchSize = 1000): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.keys.deleteExpired(this.options.retentionHours, batchSize);
      total += deleted;
      if (deleted < batchSize) return total;
    }
  }

  onModuleInit(): void {
    if (this.options.cleanupIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.run().then(
        (n) => n > 0 && this.logger.log(`Đã xóa ${n} khóa idempotency quá hạn`),
        (e: unknown) => this.logger.error(`Job dọn khóa lỗi: ${String(e)}`),
      );
    }, this.options.cleanupIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
