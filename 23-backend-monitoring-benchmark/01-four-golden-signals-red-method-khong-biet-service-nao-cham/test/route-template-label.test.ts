// (b) Route có tham số dùng template làm label: gọi 50 id khác nhau không làm số series tăng theo số id.
import { beforeAll, describe, expect, it } from 'vitest';
import { counterSnapshot, grownSeries, promQuery, viewOrder, waitFor, type CounterSnapshot } from './support/stack.js';

const IDS = Array.from({ length: 50 }, (_, i) => 101 + i);
// Ngưỡng series của một service cho metric duration (bucket): vài route × vài status × 15 bucket. URL thô với 50 id
// đã là 50 × 15 = 750 series chỉ cho một route.
const MAX_BUCKET_SERIES_PER_SERVICE = 300;

const COUNT = (service: string) =>
  `http_server_request_duration_seconds_count{service_name="${service}", http_request_method="GET", http_route!="/healthz"}`;
const before = new Map<string, CounterSnapshot>();
const grown = new Map<string, ReturnType<typeof grownSeries>>();

beforeAll(async () => {
  for (const s of ['gateway', 'checkout']) before.set(s, await counterSnapshot(COUNT(s)));
  for (const id of IDS) expect(await viewOrder(id)).toBe(200);
  // Chờ tới khi cả 50 lượt đã vào Prometheus ở cả gateway và checkout.
  await waitFor('50 lượt GET /orders/:id trong Prometheus', async () => {
    for (const s of ['gateway', 'checkout']) grown.set(s, grownSeries(before.get(s)!, await counterSnapshot(COUNT(s))));
    return [...grown.values()].every((g) => g.reduce((a, x) => a + x.delta, 0) >= IDS.length) ? true : undefined;
  });
});

describe('(b) route template thay cho URL thô', () => {
  it.each(['gateway', 'checkout'])('%s: 50 id khác nhau chỉ thành một giá trị http_route "/orders/:id"', async (service) => {
    const routes = [...new Set(grown.get(service)!.map((g) => g.metric.http_route))];
    expect(routes).toEqual(['/orders/:id']);
  });

  it.each(['gateway', 'checkout'])(`%s: số series bucket của duration không quá ${MAX_BUCKET_SERIES_PER_SERVICE}`, async (service) => {
    // Chỉ đếm bucket của các tổ hợp label vừa tăng trong lúc test (series cũ của lần chạy trước không tính).
    const combos = new Set(grown.get(service)!.map((g) => `${g.metric.http_route}|${g.metric.http_response_status_code}`));
    const buckets = await promQuery(`http_server_request_duration_seconds_bucket{service_name="${service}", http_request_method="GET"}`);
    const mine = buckets.filter((b) => combos.has(`${b.metric.http_route}|${b.metric.http_response_status_code}`));
    const count = mine.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(MAX_BUCKET_SERIES_PER_SERVICE);
  });
});
