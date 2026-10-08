import { Inject, Injectable } from '@nestjs/common';
import { md5Hex } from '../shared/md5';
import { PasswordHasher } from './password-hasher';

/**
 * [PATTERN] Giai đoạn di trú: hash cũ MD5 được BỌC thành `argon2id(md5(mật khẩu))` (hash_version = 1).
 * Cách này đóng lỗ hổng NGAY mà không cần biết mật khẩu gốc — chỉ cần chạy một migration trên cột MD5.
 * Khi người dùng đăng nhập, ta mới có mật khẩu thật để băm lại trực tiếp (nâng lên hash_version = 2).
 * Adapter chỉ tồn tại trong giai đoạn di trú; xóa khi tài khoản hoạt động đã nâng cấp hết.
 */
@Injectable()
export class LegacyHashAdapter {
  constructor(@Inject(PasswordHasher) private readonly hasher: PasswordHasher) {}

  /** Xác minh hash_version = 1: băm MD5 của mật khẩu nhập rồi so với chuỗi Argon2id đã bọc. */
  verifyWrapped(phc: string, password: string): Promise<boolean> {
    return this.hasher.verify(phc, md5Hex(password));
  }

  /** Dùng cho migration một lần: bọc một chuỗi MD5 hex có sẵn (không cần mật khẩu gốc). */
  wrapMd5(md5hex: string): Promise<string> {
    return this.hasher.hash(md5hex);
  }
}
