// Cấu hình qua biến môi trường (.env.example). Giá trị mặc định chỉ dành cho lab chạy local.

export interface Config {
  port: number;
  host: string;
  /** Độ trễ giả lập của API danh sách đơn (endpoint nặng nhất: lọc + phân trang trên DB chậm). */
  listLatencyMs: number;
  /** Chi tiết đơn, phân đơn. */
  detailLatencyMs: number;
  writeLatencyMs: number;
  /** /api/me, /api/warehouses. */
  metaLatencyMs: number;
  seed: number;
  /** Mỗi request một dòng JSON vào file này (để trống = chỉ giữ trong bộ nhớ, đọc qua GET /ops/requests). */
  requestLog: string | null;
}

const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: num(env.PORT, 3100),
    host: env.HOST ?? '127.0.0.1',
    listLatencyMs: num(env.LIST_LATENCY_MS, 1200),
    detailLatencyMs: num(env.DETAIL_LATENCY_MS, 400),
    writeLatencyMs: num(env.WRITE_LATENCY_MS, 400),
    metaLatencyMs: num(env.META_LATENCY_MS, 200),
    seed: num(env.SEED, 42),
    requestLog: env.REQUEST_LOG || null,
  };
}

export const CONFIG = Symbol('CONFIG');
