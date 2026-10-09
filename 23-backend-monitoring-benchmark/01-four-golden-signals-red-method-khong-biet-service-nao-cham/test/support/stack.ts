// Địa chỉ của stack (cổng theo bảng cổng của lab) và hàm gọi service / Prometheus / Toxiproxy cho test và bench.
export const URLS = {
  gateway: process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100',
  checkout: process.env.CHECKOUT_URL ?? 'http://127.0.0.1:3101',
  promotion: process.env.PROMOTION_URL ?? 'http://127.0.0.1:3102',
  prometheus: process.env.PROMETHEUS_URL ?? 'http://127.0.0.1:59090',
  grafana: process.env.GRAFANA_URL ?? 'http://127.0.0.1:53000',
  toxiproxy: process.env.TOXIPROXY_URL ?? 'http://127.0.0.1:58474',
};

export const SERVICES = ['gateway', 'checkout', 'promotion'] as const;

export interface PromSample {
  metric: Record<string, string>;
  value: [number, string];
}
export interface PromSeries {
  metric: Record<string, string>;
  values: [number, string][];
}

async function promGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${URLS.prometheus}${path}?${new URLSearchParams(params)}`);
  const body = (await res.json()) as { status: string; data: T; error?: string };
  if (body.status !== 'success') throw new Error(`Prometheus ${path} lỗi: ${body.error} (${JSON.stringify(params)})`);
  return body.data;
}

/** Truy vấn tức thời; trả vector. `time` tính bằng giây (Unix). */
export async function promQuery(expr: string, time?: number): Promise<PromSample[]> {
  const data = await promGet<{ resultType: string; result: PromSample[] }>('/api/v1/query', {
    query: expr,
    ...(time === undefined ? {} : { time: String(time) }),
  });
  if (data.resultType !== 'vector') throw new Error(`cần vector, nhận ${data.resultType} cho ${expr}`);
  return data.result;
}

/** Truy vấn range vector (`metric[1m]`) để lấy mẫu thô kèm đúng thời điểm ghi. */
export async function promRawSamples(selector: string): Promise<PromSeries[]> {
  const data = await promGet<{ resultType: string; result: PromSeries[] }>('/api/v1/query', { query: selector });
  if (data.resultType !== 'matrix') throw new Error(`cần matrix, nhận ${data.resultType} cho ${selector}`);
  return data.result;
}

export interface PromAlert {
  labels: Record<string, string>;
  state: 'pending' | 'firing';
  activeAt: string;
  value: string;
}
export async function promAlerts(): Promise<PromAlert[]> {
  return (await promGet<{ alerts: PromAlert[] }>('/api/v1/alerts', {})).alerts;
}

export async function promRules(): Promise<{ name: string; type: string; health: string; lastError?: string }[]> {
  const data = await promGet<{ groups: { rules: { name: string; type: string; health: string; lastError?: string }[] }[] }>(
    '/api/v1/rules',
    {},
  );
  return data.groups.flatMap((g) => g.rules);
}

/**
 * Chờ tới khi `check` trả giá trị khác undefined, hỏi lại mỗi giây. Mặc định 60 s (đường ống mất tới khoảng 20 s);
 * phép thử âm đặt TEST_WAIT_MS ngắn hơn vì lượt "đã gỡ pattern" chờ tới hết giờ.
 */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  timeoutMs = Number(process.env.TEST_WAIT_MS ?? 60_000),
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`hết ${timeoutMs} ms vẫn chưa thấy: ${what}${last ? ` (lỗi cuối: ${String(last)})` : ''}`);
}

/** Số giây từ `startMs` tới giờ, cộng lề cho chu kỳ đẩy/scrape: dùng làm cửa sổ `increase(...[Ns])`. */
export function windowSince(startMs: number, slackSeconds = 15): number {
  return Math.ceil((Date.now() - startMs) / 1000) + slackSeconds;
}

export const ORDER_BODY = { customerId: 7, items: [{ sku: 'SKU-1', qty: 2, price: 150_000 }], code: 'SALE10' };

export async function placeOrder(): Promise<number> {
  const res = await fetch(`${URLS.gateway}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ORDER_BODY),
  });
  await res.arrayBuffer();
  return res.status;
}

export async function viewOrder(id: number): Promise<number> {
  const res = await fetch(`${URLS.gateway}/orders/${id}`);
  await res.arrayBuffer();
  return res.status;
}

/** Tải nền đều đặn (đặt hàng + xem đơn) cho tới khi gọi stop(). */
export function startTraffic(intervalMs = 100): { stop: () => Promise<void> } {
  let running = true;
  let n = 0;
  const loop = (async () => {
    while (running) {
      n += 1;
      await Promise.all([placeOrder(), viewOrder((n % 1000) + 1)]).catch(() => undefined);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
  };
}

export async function toxiproxy(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${URLS.toxiproxy}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`Toxiproxy ${method} ${path} → ${res.status} ${await res.text()}`);
  }
}

/**
 * Ảnh chụp giá trị counter theo bộ label. Dùng "sau − trước" thay cho `increase()`: series MỚI xuất hiện lần đầu đã
 * mang giá trị (ví dụ 15 request trong một chu kỳ đẩy) và `increase()` không thấy bước nhảy từ 0 lên giá trị đầu,
 * còn series CŨ mà service không cập nhật nữa (tắt instrumentation, đổi tên) giữ nguyên giá trị nên không tính.
 */
export type CounterSnapshot = Map<string, { metric: Record<string, string>; value: number }>;
const labelKey = (m: Record<string, string>) =>
  JSON.stringify(Object.entries(m).filter(([k]) => k !== '__name__').sort(([a], [b]) => a.localeCompare(b)));

export async function counterSnapshot(selector: string): Promise<CounterSnapshot> {
  const snap: CounterSnapshot = new Map();
  for (const s of await promQuery(selector)) snap.set(labelKey(s.metric), { metric: s.metric, value: Number(s.value[1]) });
  return snap;
}

/**
 * Series có giá trị tăng ít nhất `minDelta` so với ảnh chụp trước (series chưa có thì coi như 0). Giá trị nhỏ hơn
 * ảnh chụp trước nghĩa là counter đã về 0 (service khởi động lại) — tính như `increase()` của Prometheus: delta = sau.
 */
export function grownSeries(before: CounterSnapshot, after: CounterSnapshot, minDelta = 1) {
  return [...after.entries()]
    .map(([k, a]) => {
      const b = before.get(k)?.value ?? 0;
      return { metric: a.metric, delta: a.value >= b ? a.value - b : a.value };
    })
    .filter((s) => s.delta >= minDelta);
}
