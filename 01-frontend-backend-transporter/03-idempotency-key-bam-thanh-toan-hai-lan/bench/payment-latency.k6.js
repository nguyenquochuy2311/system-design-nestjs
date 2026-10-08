// Độ trễ POST /{VARIANT}/payments ở tải cố định (mô hình mở, constant-arrival-rate). Mỗi request là một ý định mới
// (khóa mới), người dùng chọn theo hàm băm của số thứ tự iteration nên hai bản nhận cùng chuỗi người dùng.
// Pha warmup không tính; chỉ số lấy từ submetric {phase:measure}.
import http from 'k6/http';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

const VARIANT = __ENV.VARIANT ?? 'sau';
const RATE = Number(__ENV.RATE ?? 200);
const WARMUP = __ENV.WARMUP ?? '10s';
const DURATION = __ENV.DURATION ?? '30s';
const PREFIX = __ENV.PREFIX ?? 'k6';
const BASE = __ENV.BASE ?? 'http://127.0.0.1:3100';

// VUS đặt thì chạy mô hình đóng (constant-vus, mỗi VU gửi tuần tự) thay cho tải cố định.
const common = __ENV.VUS
  ? { executor: 'constant-vus', vus: Number(__ENV.VUS) }
  : { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 200 };
export const options = {
  scenarios: {
    warmup: { ...common, duration: WARMUP, tags: { phase: 'warmup' } },
    measure: { ...common, duration: DURATION, startTime: WARMUP, tags: { phase: 'measure' } },
  },
  // Ngưỡng chỉ để k6 tách submetric theo pha trong summary.
  thresholds: { 'http_req_duration{phase:measure}': ['max>=0'], 'ok{phase:measure}': ['rate>=0'] },
  summaryTrendStats: ['min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const ok = new Rate('ok');

function hash(n) {
  let x = (n + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export default function () {
  const n = exec.scenario.iterationInTest;
  const phase = exec.scenario.name;
  const note = `${PREFIX}-${VARIANT}-${phase}-${n}`;
  const res = http.post(`${BASE}/${VARIANT}/payments`, JSON.stringify({ merchantId: 1 + (hash(n) % 200), amount: 1000 * (1 + (hash(n + 7) % 500)), note }), {
    headers: { 'content-type': 'application/json', 'x-user-id': String(1 + (hash(n) % 10000)), 'idempotency-key': `"${note}"` },
    tags: { name: `POST /${VARIANT}/payments` },
  });
  ok.add(res.status === 201);
}

export function handleSummary(data) {
  const d = data.metrics['http_req_duration{phase:measure}']?.values ?? {};
  const out = {
    variant: VARIANT, rate: __ENV.VUS ? null : RATE, vus: __ENV.VUS ? Number(__ENV.VUS) : null, warmup: WARMUP, duration: DURATION,
    requests: data.metrics['ok{phase:measure}']?.values.passes + data.metrics['ok{phase:measure}']?.values.fails,
    okRate: data.metrics['ok{phase:measure}']?.values.rate,
    droppedIterations: data.metrics.dropped_iterations?.values.count ?? 0,
    ms: { min: d.min, med: d.med, p90: d['p(90)'], p95: d['p(95)'], p99: d['p(99)'], max: d.max },
  };
  return { [__ENV.OUT]: JSON.stringify(out, null, 2), stdout: `${JSON.stringify(out)}\n` };
}
