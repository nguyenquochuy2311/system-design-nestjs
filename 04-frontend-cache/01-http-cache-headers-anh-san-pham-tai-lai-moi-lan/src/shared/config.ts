// Cấu hình qua biến môi trường (.env.example). Giá trị mặc định chỉ dành cho lab chạy local.
export type CacheMode = 'truoc' | 'sau';

export interface Config {
  port: number;
  host: string;
  mode: CacheMode;
  sessionSecret: string;
  adminToken: string;
  mediaDir: string;
  accessLog: string | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = env.CACHE_MODE ?? 'sau';
  if (mode !== 'truoc' && mode !== 'sau') throw new Error(`CACHE_MODE phải là truoc hoặc sau, nhận: ${mode}`);
  return {
    port: Number(env.PORT ?? 3100),
    host: env.HOST ?? '127.0.0.1',
    mode,
    sessionSecret: env.SESSION_SECRET ?? 'lab-only-session-secret',
    adminToken: env.ADMIN_TOKEN ?? 'lab-only-admin-token',
    mediaDir: env.MEDIA_DIR ?? '.data/media',
    accessLog: env.ACCESS_LOG || null,
  };
}

export const CONFIG = Symbol('CONFIG');
