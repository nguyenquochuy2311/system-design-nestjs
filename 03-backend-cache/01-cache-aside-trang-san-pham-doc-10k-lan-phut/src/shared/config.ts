// Cấu hình đọc từ biến môi trường; mặc định khớp docker-compose.yml và .env.example.
const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} phải là số, nhận "${raw}"`);
  return value;
};

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  /** Chờ Redis tối đa bao lâu cho mỗi lệnh trước khi bỏ qua cache (mục 3.3: 50 ms). */
  redisCommandTimeoutMs: number;
  port: number;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/catalog',
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
    redisCommandTimeoutMs: num('REDIS_COMMAND_TIMEOUT_MS', 50),
    port: num('PORT', 3100),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
