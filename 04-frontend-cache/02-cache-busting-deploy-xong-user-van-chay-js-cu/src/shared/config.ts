// Cấu hình qua biến môi trường (.env.example). Giá trị mặc định chỉ dành cho lab chạy local.
import { isReleaseId, type ReleaseId, type Site } from '../../web/releases';

export interface Config {
  site: Site;
  port: number;
  host: string;
  /** Bản đang chạy lúc khởi động; script deploy đổi qua POST /ops/release. */
  release: ReleaseId;
  opsToken: string;
  /** Mỗi request một dòng JSON (để trống = tắt). */
  requestLog: string | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const site = env.SITE ?? 'sau';
  if (site !== 'truoc' && site !== 'sau') throw new Error(`SITE phải là truoc hoặc sau, nhận: ${site}`);
  const release = env.RELEASE ?? '41';
  if (!isReleaseId(release)) throw new Error(`RELEASE không có trong web/releases.ts: ${release}`);
  return {
    site,
    port: Number(env.PORT ?? (site === 'sau' ? 3100 : 3101)),
    host: env.HOST ?? '127.0.0.1',
    release,
    opsToken: env.OPS_TOKEN ?? 'lab-only-ops-token',
    requestLog: env.REQUEST_LOG || null,
  };
}

export const CONFIG = Symbol('CONFIG');
