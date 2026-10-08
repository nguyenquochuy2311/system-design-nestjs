/** Tham số Argon2id và các ngưỡng của luồng đăng nhập, đặt ở một chỗ, đọc từ cấu hình. */
export const HASHER_OPTIONS = Symbol('HASHER_OPTIONS');

export interface HasherOptions {
  /** Bộ nhớ mỗi lần băm, đơn vị KiB (ví dụ 65536 = 64 MiB). */
  memoryCost: number;
  /** Số vòng lặp (time cost). */
  timeCost: number;
  /** Số lane song song. */
  parallelism: number;
  /** Pepper: khóa bí mật ngoài DB trộn vào trước khi băm (tham số `secret`), hoặc null nếu không dùng. */
  pepper: Buffer | null;
}

export const LOGIN_OPTIONS = Symbol('LOGIN_OPTIONS');

export interface LoginOptions {
  /** Chặn sau bao nhiêu lần sai liên tiếp (lần thứ max+1 nhận 429). */
  maxFailures: number;
  /** Cửa sổ đếm (giây). */
  windowSeconds: number;
}

/** Đọc tham số từ biến môi trường cho tiến trình thật; test tự truyền giá trị. */
export function hasherOptionsFromEnv(): HasherOptions {
  const pepper = process.env.PASSWORD_PEPPER;
  return {
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 65536),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 5),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    pepper: pepper ? Buffer.from(pepper, 'utf8') : null,
  };
}

export function loginOptionsFromEnv(): LoginOptions {
  return {
    maxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? 10),
    windowSeconds: Number(process.env.LOGIN_FAILURE_WINDOW_SECONDS ?? 900),
  };
}
