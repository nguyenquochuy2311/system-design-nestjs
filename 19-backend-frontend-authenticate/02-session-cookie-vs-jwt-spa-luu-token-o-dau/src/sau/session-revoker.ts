import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, userSessionsKey } from '../shared/redis';
import { SESS_PREFIX } from './session.config';

/**
 * [PATTERN] Thu hồi phiên theo user. Mỗi phiên đăng nhập được ghi id vào tập `user_sessions:<userId>`;
 * khóa tài khoản hoặc "đăng xuất mọi thiết bị" chỉ cần xóa MỌI bản ghi `sess:<id>` trong tập rồi xóa tập.
 * Request kế tiếp của phiên đó không nạp được dữ liệu phiên → SessionGuard trả 401 ngay (tính bằng giây).
 */
@Injectable()
export class SessionRevoker {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async addSession(userId: string, sessionId: string): Promise<void> {
    await this.redis.sadd(userSessionsKey(userId), sessionId);
  }

  async removeSession(userId: string, sessionId: string): Promise<void> {
    await this.redis.srem(userSessionsKey(userId), sessionId);
  }

  /** Xóa mọi phiên của user; trả về số id đã có trong tập. */
  async revokeAllForUser(userId: string): Promise<number> {
    const key = userSessionsKey(userId);
    const ids = await this.redis.smembers(key);
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.del(`${SESS_PREFIX}${id}`); // [PATTERN] xóa bản ghi phiên khỏi Redis
    pipe.del(key);
    await pipe.exec();
    return ids.length;
  }
}
