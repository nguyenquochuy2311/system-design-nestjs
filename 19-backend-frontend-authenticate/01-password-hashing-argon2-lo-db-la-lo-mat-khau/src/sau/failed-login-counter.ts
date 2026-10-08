import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../shared/redis';
import { LOGIN_OPTIONS, type LoginOptions } from './password-hasher.options';

/**
 * [PATTERN] Hash chậm chỉ bảo vệ offline (khi kẻ tấn công đã có file hash). Online, kẻ tấn công thử mật
 * khẩu qua chính endpoint đăng nhập, nên phải có bộ đếm sai: sai quá ngưỡng trong cửa sổ thì chặn (429).
 * Lưu trong Redis với TTL. Chi tiết về rate limiting phân tán ở scope 13 bài 03.
 */
@Injectable()
export class FailedLoginCounter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(LOGIN_OPTIONS) private readonly opts: LoginOptions,
  ) {}

  private key(subject: string): string {
    return `login:fail:${subject.toLowerCase()}`;
  }

  async currentCount(subject: string): Promise<number> {
    const v = await this.redis.get(this.key(subject));
    return v ? Number(v) : 0;
  }

  async isBlocked(subject: string): Promise<boolean> {
    return (await this.currentCount(subject)) >= this.opts.maxFailures;
  }

  /** Tăng bộ đếm; đặt TTL ở lần sai đầu tiên (cửa sổ tính từ lần sai đầu). Trả về số lần sai hiện tại. */
  async recordFailure(subject: string): Promise<number> {
    const key = this.key(subject);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, this.opts.windowSeconds);
    return count;
  }

  async reset(subject: string): Promise<void> {
    await this.redis.del(this.key(subject));
  }
}
