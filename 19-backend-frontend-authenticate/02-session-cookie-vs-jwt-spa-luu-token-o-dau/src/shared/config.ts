// Cấu hình đọc từ biến môi trường. KHÔNG có giá trị mặc định cứng cho secret trong mã chạy thật:
// thiếu secret thì ném ngay khi khởi động (test tự truyền CONFIG qua overrideProvider).
export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  port: number;
  /** Khóa ký cookie phiên của express-session. */
  sessionSecret: string;
  /** Khóa HMAC ký token CSRF (double-submit có ký). */
  csrfSecret: string;
  /** Khóa ký JWT HS256 cho bản `truoc`. */
  jwtSecret: string;
  /** Origin được phép gửi request đổi dữ liệu (kiểm tra Origin cho CSRF). */
  allowedOrigins: string[];
  cookieName: string;
  cookieSecure: boolean;
  /** Hạn nhàn rỗi (giây): Redis TTL, gia hạn mỗi request (rolling). */
  sessionIdleSeconds: number;
  /** Hạn tuyệt đối (giây): phiên chết sau mốc này dù còn hoạt động. */
  sessionAbsoluteSeconds: number;
  /** Lab chạy http://localhost: báo cho express-session biết localhost là secure context để phát cookie Secure. */
  trustLocalhostSecure: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường bắt buộc: ${name} (xem .env.example)`);
  return v;
}

export function configFromEnv(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:56379',
    port: Number(process.env.PORT ?? 3100),
    sessionSecret: required('SESSION_SECRET'),
    csrfSecret: required('CSRF_SECRET'),
    jwtSecret: required('JWT_SECRET'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3200,http://127.0.0.1:3200').split(',').map((s) => s.trim()),
    cookieName: process.env.COOKIE_NAME ?? '__Host-sid',
    cookieSecure: process.env.COOKIE_SECURE !== '0',
    sessionIdleSeconds: Number(process.env.SESSION_IDLE_SECONDS ?? 1800),
    sessionAbsoluteSeconds: Number(process.env.SESSION_ABSOLUTE_SECONDS ?? 43200),
    trustLocalhostSecure: process.env.TRUST_LOCALHOST_SECURE === '1', // bật tường minh, mặc định tắt
  };
}
