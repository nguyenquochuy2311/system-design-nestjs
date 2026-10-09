// (a) Mọi service phơi đủ ba tín hiệu RED với cùng bộ label — kiểm trên dữ liệu thật trong Prometheus.
// Chỉ tính series có số đếm TĂNG trong lúc test (so ảnh chụp trước/sau): series cũ còn lại sau khi một service tắt
// instrumentation hay đổi tên không làm test xanh giả.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SERVICES,
  counterSnapshot,
  grownSeries,
  placeOrder,
  promQuery,
  toxiproxy,
  viewOrder,
  waitFor,
  type CounterSnapshot,
} from './support/stack.js';

// Bộ label bắt buộc trên series RED (tên sau khi Collector đổi từ semantic conventions sang Prometheus).
const RED_LABELS = ['service_name', 'http_route', 'http_request_method', 'http_response_status_code'];
const COUNT = (service: string) => `http_server_request_duration_seconds_count{service_name="${service}", http_route!="/healthz"}`;
const ROUNDS = 15;

const before = new Map<string, CounterSnapshot>();

beforeAll(async () => {
  for (const s of SERVICES) before.set(s, await counterSnapshot(COUNT(s)));
  for (let i = 1; i <= ROUNDS; i++) {
    expect(await placeOrder()).toBe(201); // gateway → checkout → promotion → DB
    expect(await viewOrder(i)).toBe(200); // gateway → checkout → DB
  }
});

async function freshSeries(service: string) {
  return waitFor(`series RED của ${service} tăng trong lúc test`, async () => {
    const grown = grownSeries(before.get(service)!, await counterSnapshot(COUNT(service)));
    return grown.reduce((s, g) => s + g.delta, 0) >= ROUNDS ? grown : undefined;
  });
}

describe('(a) mọi service phơi đủ Rate, Errors, Duration với cùng bộ label', () => {
  it.each(SERVICES)('%s: có series đếm request tăng trong lúc test, đủ label RED', async (service) => {
    for (const s of await freshSeries(service)) {
      for (const label of RED_LABELS) expect(s.metric[label], `${service} thiếu label ${label}`).toBeTruthy();
    }
  });

  it.each(SERVICES)('%s: Duration là histogram có đủ 15 bucket `le` cho series vừa tăng', async (service) => {
    const fresh = await freshSeries(service);
    for (const s of fresh) {
      const m = s.metric;
      const buckets = await promQuery(
        `http_server_request_duration_seconds_bucket{service_name="${service}", http_route="${m.http_route}", http_request_method="${m.http_request_method}", http_response_status_code="${m.http_response_status_code}"}`,
      );
      // 14 ranh giới của semantic conventions + "+Inf"; bucket "+Inf" bằng đúng số đếm.
      expect(new Set(buckets.map((b) => b.metric.le)).size).toBe(15);
      expect(buckets.find((b) => b.metric.le === '+Inf')).toBeDefined();
    }
  });

  it.each(SERVICES)('%s: recording rule cho đủ ba tín hiệu (rate > 0, tỉ lệ lỗi là số, p95 là số)', async (service) => {
    const signals = await waitFor(`recording rule của ${service}`, async () => {
      const [rate, errors, p95] = await Promise.all([
        promQuery(`service_name:http_server_requests:rate1m{service_name="${service}"}`),
        promQuery(`service_name:http_server_errors:ratio_rate1m{service_name="${service}"}`),
        promQuery(`service_name:http_server_request_duration_seconds:p95_1m{service_name="${service}"}`),
      ]);
      if (!rate[0] || !errors[0] || !p95[0]) return undefined;
      const v = { rate: Number(rate[0].value[1]), errors: Number(errors[0].value[1]), p95: Number(p95[0].value[1]) };
      return v.rate > 0 && Number.isFinite(v.errors) && Number.isFinite(v.p95) ? v : undefined;
    });
    expect(signals.rate).toBeGreaterThan(0);
  });
});

describe('(a) Errors tách được service gây lỗi', () => {
  afterAll(async () => {
    await toxiproxy('POST', '/proxies/checkout_db', { enabled: true });
  });

  it('DB của checkout không kết nối được: lỗi tăng ở checkout và gateway, promotion không có lỗi', async () => {
    const ERRORS = (service: string) => `http_server_request_duration_seconds_count{service_name="${service}", error_type!=""}`;
    const PROMO = 'http_server_request_duration_seconds_count{service_name="promotion", http_route="/promotions/:code"}';
    const snap = async () => ({
      checkout: await counterSnapshot(ERRORS('checkout')),
      gateway: await counterSnapshot(ERRORS('gateway')),
      promotion: await counterSnapshot(ERRORS('promotion')),
      promoCalls: await counterSnapshot(PROMO),
    });
    const sum = (a: CounterSnapshot, b: CounterSnapshot) => grownSeries(a, b).reduce((s, g) => s + g.delta, 0);
    const t0 = await snap();

    // Tắt proxy checkout → DB: kết nối mới bị từ chối, checkout trả 500, gateway trả 502.
    await toxiproxy('POST', '/proxies/checkout_db', { enabled: false });
    for (let i = 0; i < 10; i++) expect(await placeOrder()).toBe(502);
    await toxiproxy('POST', '/proxies/checkout_db', { enabled: true });

    const seen = await waitFor('lỗi của checkout, gateway và lượt gọi promotion trong Prometheus', async () => {
      const t1 = await snap();
      const d = { checkout: sum(t0.checkout, t1.checkout), gateway: sum(t0.gateway, t1.gateway), promotion: sum(t0.promotion, t1.promotion), promoCalls: sum(t0.promoCalls, t1.promoCalls) };
      return d.checkout >= 10 && d.gateway >= 10 && d.promoCalls >= 10 ? d : undefined;
    });
    // promotion vẫn nhận request (checkout hỏi mã giảm giá trước khi ghi DB) nhưng không lỗi.
    expect(seen.promotion).toBe(0);
  });
});
