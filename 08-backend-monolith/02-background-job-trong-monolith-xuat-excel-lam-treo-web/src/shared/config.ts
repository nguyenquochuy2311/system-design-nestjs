// Cấu hình đọc từ biến môi trường (mặc định khớp docker-compose.yml và .env.example).
// Web và worker đọc cùng một cấu hình: hai process type của cùng một ứng dụng (Twelve-Factor, "Config").
const env = (name: string, fallback: string): string => process.env[name] ?? fallback;
const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} phải là số, nhận "${raw}"`);
  return value;
};

export interface AppConfig {
  databaseUrl: string;
  port: number;
  s3: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  exports: {
    queue: string;
    /** Visibility timeout (giây) khi worker đọc message; worker gia hạn trong lúc còn sống. */
    visibilityTimeoutSeconds: number;
    /** Số lần đọc tối đa (read_ct) trước khi archive message và đánh dấu job failed. */
    maxAttempts: number;
    downloadTtlSeconds: number;
    batchSize: number;
    /** Chỉ dùng cho test và diễn tập kill worker: làm chậm có chủ đích mỗi lô dòng. */
    batchDelayMs: number;
  };
  worker: { concurrency: number; pollMs: number };
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: env('DATABASE_URL', 'postgres://app:app@localhost:55432/sales'),
    port: num('PORT', 3100),
    s3: {
      endpoint: env('S3_ENDPOINT', 'http://127.0.0.1:59000'),
      region: env('S3_REGION', 'us-east-1'),
      accessKeyId: env('S3_ACCESS_KEY', 'labaccess'),
      secretAccessKey: env('S3_SECRET_KEY', 'labsecret123'),
      bucket: env('S3_BUCKET', 'exports'),
    },
    exports: {
      queue: env('EXPORT_QUEUE', 'exports'),
      visibilityTimeoutSeconds: num('EXPORT_VT_SECONDS', 300),
      maxAttempts: num('EXPORT_MAX_ATTEMPTS', 3),
      downloadTtlSeconds: num('EXPORT_DOWNLOAD_TTL_SECONDS', 900),
      batchSize: num('EXPORT_BATCH_SIZE', 1000),
      batchDelayMs: num('EXPORT_BATCH_DELAY_MS', 0),
    },
    worker: { concurrency: num('WORKER_CONCURRENCY', 1), pollMs: num('WORKER_POLL_MS', 500) },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
