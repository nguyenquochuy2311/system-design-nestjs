import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * ioredis cấu hình cho cache (nhật ký quyết định, bài 03/01): lệnh chờ tối đa commandTimeoutMs, mất kết nối thì lỗi ngay
 * thay vì xếp hàng, không gửi lại lệnh, vẫn kết nối lại mỗi ≤ 1 giây. Đường đọc trang dùng 50 ms; worker dùng dài hơn
 * vì lỗi ở worker chỉ làm sự kiện được thử lại ở lượt sau, không làm khách chờ.
 */
export function createRedis(url: string, commandTimeoutMs: number, name = 'Redis'): Redis {
  const logger = new Logger(name);
  const redis = new Redis(url, {
    commandTimeout: commandTimeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1_000,
    retryStrategy: (times) => Math.min(times * 100, 1_000),
  });
  // Không gắn listener 'error' thì ioredis in "Unhandled error event" mỗi lần thử kết nối lại; chỉ log khi trạng thái đổi.
  let down = false;
  redis.on('error', (err: Error) => {
    if (!down) logger.warn(`Redis không dùng được (${url}): ${err.message}`);
    down = true;
  });
  redis.on('ready', () => {
    if (down) logger.warn(`Redis đã kết nối lại (${url})`);
    down = false;
  });
  return redis;
}
