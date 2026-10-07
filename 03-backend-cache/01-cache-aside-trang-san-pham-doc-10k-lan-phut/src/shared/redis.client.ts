import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * ioredis cấu hình cho cache, không phải cho dữ liệu phải giữ: thà bỏ qua cache còn hơn bắt trang sản phẩm chờ Redis.
 * Mặc định của ioredis là xếp lệnh vào hàng đợi khi mất kết nối và thử lại tới 20 lần, nên Redis chết thì request treo theo.
 */
export function createRedis(url: string, commandTimeoutMs: number): Redis {
  const logger = new Logger('Redis');
  const redis = new Redis(url, {
    commandTimeout: commandTimeoutMs, // [PATTERN] chờ tối đa N ms rồi báo lỗi, service rơi về DB (fail open)
    enableOfflineQueue: false, // [PATTERN] mất kết nối thì lệnh lỗi ngay, không xếp hàng chờ kết nối lại
    maxRetriesPerRequest: 0, // lệnh đang chạy khi rớt kết nối thì báo lỗi ngay, không gửi lại
    connectTimeout: 1_000,
    retryStrategy: (times) => Math.min(times * 100, 1_000), // vẫn kết nối lại mãi, tối đa mỗi giây một lần
  });
  // Không gắn listener 'error' thì ioredis in "Unhandled error event" mỗi lần thử kết nối lại.
  // Chỉ log khi trạng thái đổi để giờ Redis chết không thành hàng nghìn dòng log mỗi phút.
  let down = false;
  redis.on('error', (err: Error) => {
    if (!down) logger.warn(`Redis không dùng được (${url}): ${err.message}; trang sản phẩm đọc thẳng DB tới khi kết nối lại`);
    down = true;
  });
  redis.on('ready', () => {
    if (down) logger.warn(`Redis đã kết nối lại (${url})`);
    down = false;
  });
  return redis;
}
