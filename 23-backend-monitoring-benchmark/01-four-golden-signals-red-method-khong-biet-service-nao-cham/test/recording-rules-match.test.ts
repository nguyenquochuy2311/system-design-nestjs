// (c) Recording rule cho cùng kết quả với truy vấn gốc. Truy vấn gốc viết lại độc lập ở đây (không đọc từ file rule),
// nên sửa sai file rule thì test đỏ. So từng mẫu của rule tại ĐÚNG thời điểm rule ghi (lấy bằng range vector),
// chạy truy vấn gốc với `time` = thời điểm đó.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVICES, promQuery, promRawSamples, promRules, startTraffic, waitFor } from './support/stack.js';

const RAW = 'http_server_request_duration_seconds';
const CASES: { rule: string; reference: string; keys: string[] }[] = [
  {
    rule: 'service_name:http_server_requests:rate1m',
    reference: `sum by (service_name) (rate(${RAW}_count[1m]))`,
    keys: ['service_name'],
  },
  {
    rule: 'service_name:http_server_errors:ratio_rate1m',
    // Không có lỗi nào thì truy vấn gốc trả rỗng; rule (có vế `or ... * 0`) trả 0. So theo "rỗng = 0".
    reference: `sum by (service_name) (rate(${RAW}_count{error_type!=""}[1m])) / sum by (service_name) (rate(${RAW}_count[1m]))`,
    keys: ['service_name'],
  },
  {
    rule: 'service_name:http_server_request_duration_seconds:p95_1m',
    reference: `histogram_quantile(0.95, sum by (le, service_name) (rate(${RAW}_bucket[1m])))`,
    keys: ['service_name'],
  },
  {
    rule: 'service_name:http_server_request_duration_seconds:p99_1m',
    reference: `histogram_quantile(0.99, sum by (le, service_name) (rate(${RAW}_bucket[1m])))`,
    keys: ['service_name'],
  },
  {
    rule: 'service_name_server_address:http_client_request_duration_seconds:p95_1m',
    reference: 'histogram_quantile(0.95, sum by (le, service_name, server_address) (rate(http_client_request_duration_seconds_bucket[1m])))',
    keys: ['service_name', 'server_address'],
  },
];

// Sai số cho phép: một lượt scrape ghi trễ hơn lúc rule chạy có thể lệch vài phần trăm (rule không thấy, truy vấn
// sau thấy). Lệch do biểu thức sai (thiếu `le`, sai label) thì là "không có series" hoặc lệch nhiều lần.
const REL_TOLERANCE = 0.02;

let traffic: { stop: () => Promise<void> };

beforeAll(async () => {
  traffic = startTraffic(100);
  // Cần dữ liệu đều trong cửa sổ [1m] trước khi so. Chờ trên TRUY VẤN GỐC (không chờ rule), để rule sai thì chính
  // test so sánh đỏ với thông báo rõ, không phải hook hết giờ.
  await waitFor(
    'truy vấn gốc p95 có giá trị cho cả 3 service',
    async () => {
      const r = await promQuery(CASES[2]!.reference);
      return SERVICES.every((s) => r.some((x) => x.metric.service_name === s && Number.isFinite(Number(x.value[1]))))
        ? r
        : undefined;
    },
    90_000,
  );
  // Thêm 35 s để mọi mẫu được so (cũ 15–30 s) đều nằm sau lúc có tải; nếu trước đó hệ thống rảnh thì mẫu lúc đầu là NaN.
  await new Promise((r) => setTimeout(r, 35_000));
});

afterAll(async () => {
  await traffic.stop();
});

const keyOf = (m: Record<string, string>, keys: string[]) => keys.map((k) => `${k}=${m[k] ?? ''}`).join(',');

describe('(c) recording rule khớp truy vấn gốc', () => {
  it('mọi rule và alert đều nạp được, không lỗi khi đánh giá', async () => {
    const rules = await promRules();
    for (const c of CASES) expect(rules.find((r) => r.name === c.rule), c.rule).toBeDefined();
    for (const r of rules) expect(`${r.name}: ${r.health} ${r.lastError ?? ''}`.trim()).toBe(`${r.name}: ok`);
  });

  it.each(CASES.map((c) => [c.rule, c] as const))('%s', async (_name, c) => {
    const series = await promRawSamples(`${c.rule}[1m]`);
    const nowSec = Date.now() / 1000;
    // Mẫu mới nhất cũ hơn 15 s: mọi lượt scrape trước thời điểm đó chắc chắn đã ghi xong.
    const samples = series.flatMap((s) => {
      // Và không cũ quá 30 s: rule đánh giá mỗi 5 s, mẫu cũ hơn nghĩa là rule đã ngừng ra series này.
      const v = [...s.values].reverse().find(([t]) => t <= nowSec - 15);
      return v && v[0] >= nowSec - 30 ? [{ key: keyOf(s.metric, c.keys), t: v[0], value: Number(v[1]) }] : [];
    });
    const services = new Set(samples.map((s) => s.key.split(',')[0]));
    for (const svc of c.keys.length === 1 ? SERVICES : ['gateway', 'checkout']) {
      expect(services.has(`service_name=${svc}`), `${c.rule} thiếu service ${svc}`).toBe(true);
    }

    let compared = 0;
    for (const s of samples) {
      const ref = await promQuery(c.reference, s.t);
      const match = ref.find((r) => keyOf(r.metric, c.keys) === s.key);
      // Không có request trong cửa sổ (series cũ của service đã dừng): rule chia 0/0 = NaN, truy vấn gốc rỗng.
      if (!match && Number.isNaN(s.value)) continue;
      const refValue = match ? Number(match.value[1]) : c.rule.includes('errors') ? 0 : Number.NaN;
      if (Number.isNaN(s.value) && Number.isNaN(refValue)) continue;
      expect(Math.abs(s.value - refValue), `${c.rule} {${s.key}} @${s.t}: rule=${s.value} gốc=${refValue}`).toBeLessThanOrEqual(
        1e-9 + REL_TOLERANCE * Math.abs(refValue),
      );
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });
});
