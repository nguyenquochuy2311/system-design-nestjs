// Cấu hình đọc từ biến môi trường; mặc định khớp docker-compose.yml và .env.example.
export const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} phải là số, nhận "${raw}"`);
  return value;
};

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  /** Chờ Redis tối đa bao lâu cho mỗi lệnh đọc trang trước khi bỏ qua cache (bài 03/01: 50 ms). */
  redisCommandTimeoutMs: number;
  port: number;
  /** TTL của key trang (giây): bản trước dùng đúng giá trị này, bản sau ± pageTtlJitterPct %. */
  pageTtlS: number;
  pageTtlJitterPct: number;
  /** Chỉ dùng khi đo: sản phẩm cần theo dõi và file ghi mỗi câu trả lời có chứa chúng. */
  watchIds: number[];
  watchLog: string | null;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/shop',
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
    redisCommandTimeoutMs: num('REDIS_COMMAND_TIMEOUT_MS', 50),
    port: num('PORT', 3100),
    pageTtlS: num('PAGE_TTL_S', 900),
    pageTtlJitterPct: num('PAGE_TTL_JITTER_PCT', 10),
    watchIds: (process.env.WATCH_IDS ?? '').split(',').filter(Boolean).map(Number),
    watchLog: process.env.WATCH_LOG || null,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
