import { Inject, Injectable } from '@nestjs/common';
import { Algorithm, Version, hash, parseOptions, verify } from '@node-rs/argon2';
import { HASHER_OPTIONS, type HasherOptions } from './password-hasher.options';

/**
 * [PATTERN] PasswordHasher: bọc Argon2id (RFC 9106) — hàm băm memory-hard, chậm, có salt riêng từng lần.
 * Mỗi lần băm cần hàng chục MiB RAM nên GPU/ASIC mất lợi thế hàng nghìn lần so với MD5. Tham số đặt ở một
 * chỗ, đọc từ cấu hình, đo lại trên máy đích mỗi khi đổi hạ tầng. Thư viện chạy trên threadpool của libuv
 * (không chặn event loop); giới hạn số hash song song bằng UV_THREADPOOL_SIZE.
 */
@Injectable()
export class PasswordHasher {
  constructor(@Inject(HASHER_OPTIONS) private readonly opts: HasherOptions) {}

  private argonOptions() {
    return {
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
      memoryCost: this.opts.memoryCost,
      timeCost: this.opts.timeCost,
      parallelism: this.opts.parallelism,
      // [PATTERN] pepper trộn qua tham số secret: không nằm trong chuỗi PHC, nên lộ DB mà không lộ pepper
      // thì toàn bộ hash vô dụng với kẻ tấn công.
      ...(this.opts.pepper ? { secret: this.opts.pepper } : {}),
    };
  }

  /** Băm mật khẩu → chuỗi PHC `$argon2id$v=19$m=..,t=..,p=..$salt$hash`. Salt ngẫu nhiên tự sinh mỗi lần. */
  async hash(password: string): Promise<string> {
    // Không cắt độ dài: Argon2id băm cả chuỗi dài (khác bcrypt giới hạn 72 byte).
    return hash(password, this.argonOptions());
  }

  /** Xác minh. So khớp thời gian cố định bên trong; sai mật khẩu / sai pepper trả false, không ném. */
  async verify(phc: string, password: string): Promise<boolean> {
    try {
      return await verify(phc, password, this.opts.pepper ? { secret: this.opts.pepper } : {});
    } catch {
      // Chuỗi hash hỏng định dạng: coi như không khớp, không làm sập request.
      return false;
    }
  }

  /**
   * [PATTERN] Hash cũ hơn tham số hiện hành (ví dụ sau khi tăng chi phí theo thời gian) cần băm lại.
   * Đọc tham số ngay trong chuỗi PHC để so với cấu hình đang dùng.
   */
  needsRehash(phc: string): boolean {
    let parsed: ReturnType<typeof parseOptions>;
    try {
      parsed = parseOptions(phc);
    } catch {
      return true; // không phải chuỗi Argon2id hợp lệ → băm lại
    }
    if (parsed.algorithm !== Algorithm.Argon2id) return true;
    if ((parsed.version ?? -1) !== Version.V0x13) return true;
    return (
      (parsed.memoryCost ?? 0) < this.opts.memoryCost ||
      (parsed.timeCost ?? 0) < this.opts.timeCost ||
      (parsed.parallelism ?? 0) < this.opts.parallelism
    );
  }
}
