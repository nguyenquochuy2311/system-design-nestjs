export interface IdempotencyOptions {
  /** Khóa "processing" quá thời gian này thì được tiếp quản (ms). Phải dài hơn thời gian xử lý lâu nhất của request. */
  lockTimeoutMs: number;
  /** Giữ khóa bao lâu (giờ). Stripe cho phép xóa khóa khi đã ít nhất 24 giờ; phải dài hơn cửa sổ retry của app. */
  retentionHours: number;
  /** Chu kỳ chạy job dọn trong tiến trình API (ms); 0 = tắt. */
  cleanupIntervalMs: number;
}

export const IDEMPOTENCY_OPTIONS = Symbol('IDEMPOTENCY_OPTIONS');

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): IdempotencyOptions {
  return {
    lockTimeoutMs: Number(env.IDEMPOTENCY_LOCK_TIMEOUT_MS ?? 30_000),
    retentionHours: Number(env.IDEMPOTENCY_RETENTION_HOURS ?? 24),
    cleanupIntervalMs: Number(env.IDEMPOTENCY_CLEANUP_INTERVAL_MS ?? 0),
  };
}
