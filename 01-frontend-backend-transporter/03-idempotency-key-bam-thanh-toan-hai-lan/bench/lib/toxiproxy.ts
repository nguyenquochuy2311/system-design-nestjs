/**
 * Điều khiển Toxiproxy qua HTTP API (cổng 58474). Proxy `payments_api` nghe 58401 và chuyển tới API trên host.
 * "Cắt response sau khi server commit" = toxic `limit_data` 0 byte trên chiều downstream (API → client): request đi
 * tới API nguyên vẹn, API xử lý và commit, còn response bị Toxiproxy bỏ và đóng kết nối (client nhận "socket hang up").
 * CUT_MODE=timeout: toxic `timeout` 0 ms trên downstream — response bị nuốt, kết nối treo tới khi client hết giờ
 * (giống app chờ 10 giây rồi gửi lại). CUT_MODE=none: không cắt gì (đối chứng cho đường đi qua proxy).
 */
export const CUT_MODE = process.env.CUT_MODE === 'timeout' ? 'timeout' : process.env.CUT_MODE === 'none' ? 'none' : 'limit_data';
const API = process.env.TOXIPROXY_URL ?? 'http://localhost:58474';
export const PROXY_NAME = 'payments_api';
export const PROXY_PORT = Number(process.env.PROXY_PORT ?? 58401);
export const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const CUT = 'cut_response';

async function call(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`Toxiproxy ${method} ${path} → ${res.status} ${await res.text()}`);
}

/** Trỏ proxy tới API đang nghe ở `port` trên host; xóa mọi toxic còn sót. */
export async function pointProxyTo(port: number): Promise<void> {
  await call('POST', '/reset');
  // Toxiproxy 2.12 báo POST để sửa proxy đã cũ (log "Use HTTP PATCH instead").
  await call('PATCH', `/proxies/${PROXY_NAME}`, { upstream: `host.docker.internal:${port}`, enabled: true });
}

let cutting = false;
/** Bật/tắt việc cắt response; chỉ gọi API của Toxiproxy khi trạng thái đổi. */
export async function cutResponses(on: boolean): Promise<void> {
  if (on === cutting || CUT_MODE === 'none') return;
  const attributes = CUT_MODE === 'timeout' ? { timeout: 0 } : { bytes: 0 };
  if (on) await call('POST', `/proxies/${PROXY_NAME}/toxics`, { name: CUT, type: CUT_MODE, stream: 'downstream', toxicity: 1, attributes });
  else await call('DELETE', `/proxies/${PROXY_NAME}/toxics/${CUT}`);
  cutting = on;
}
