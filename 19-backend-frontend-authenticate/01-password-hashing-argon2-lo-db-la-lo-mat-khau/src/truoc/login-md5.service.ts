import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { md5Hex } from '../shared/md5';

/**
 * Bản "trước": xác minh bằng cách so MD5(mật khẩu) với cột đã lưu. Không salt, không làm chậm, không
 * giới hạn số lần thử. Đúng là hệ thống đăng nhập được — nhưng file hash coi như là mật khẩu rõ.
 */
@Injectable()
export class LoginMd5Service {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async login(email: string, password: string): Promise<{ ok: boolean; userId?: string }> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_md5'])
      .where('email', '=', email)
      .executeTakeFirst();
    if (!user) return { ok: false };
    // So sánh chuỗi hex trực tiếp: nhanh, không salt — chính là điểm yếu.
    if (md5Hex(password) !== user.password_md5) return { ok: false };
    return { ok: true, userId: user.id };
  }
}
