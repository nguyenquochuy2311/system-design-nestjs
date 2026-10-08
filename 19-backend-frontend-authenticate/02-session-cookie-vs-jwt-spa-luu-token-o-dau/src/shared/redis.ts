import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

/** ioredis cho session store + tập phiên theo user. Cấu hình theo nhật ký 03/01 điểm 2. */
export function createRedis(url: string): Redis {
  const client = new Redis(url, {
    commandTimeout: 500,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  });
  client.on('error', () => {});
  return client;
}

/** Khóa tập phiên của một user: dùng để "đăng xuất mọi thiết bị" và khóa tài khoản bằng một lần xóa. */
export const userSessionsKey = (userId: string) => `user_sessions:${userId}`;
