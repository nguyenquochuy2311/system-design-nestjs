import Redis from 'ioredis';

/** Token DI của ioredis. */
export const REDIS = Symbol('REDIS');
export const DEFAULT_REDIS_URL = 'redis://localhost:56379';

export function createRedis(url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL): Redis {
  const client = new Redis(url, {
    // Bộ đếm sai không phải đường nóng về hiệu năng; đặt timeout ngắn và không treo khi Redis chưa sẵn sàng
    // (nhật ký 03/01 điểm 2). Lỗi Redis được bắt ở tầng trên và xử theo hướng fail-open có ghi log.
    commandTimeout: 200,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  });
  // Luôn gắn listener error, nếu không ioredis ném "Unhandled error event".
  client.on('error', () => {});
  return client;
}
