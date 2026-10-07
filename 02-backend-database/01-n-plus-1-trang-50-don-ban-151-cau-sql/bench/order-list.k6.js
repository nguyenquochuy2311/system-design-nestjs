// Đo trang danh sách đơn (và tùy chọn luồng đặt hàng chạy song song).
// Ví dụ: k6 run -e MODE=naive -e VUS=10 -e DURATION=30s -e NAME=A-naive-no-index bench/order-list.k6.js
// Biến: MODE=naive|batch · VUS · DURATION · LIST=true|false · PLACE_RATE (request/giây, 0 = tắt) · NAME · BASE_URL
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const MODE = __ENV.MODE || 'batch';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';
const LIST = (__ENV.LIST || 'true') === 'true';
const PLACE_RATE = Number(__ENV.PLACE_RATE || 0);
const NAME = __ENV.NAME || MODE;

const scenarios = {};
if (LIST) {
  scenarios.list = { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'listOrders', gracefulStop: '120s' };
}
if (PLACE_RATE > 0) {
  scenarios.place = {
    executor: 'constant-arrival-rate',
    rate: PLACE_RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 10,
    maxVUs: 100,
    exec: 'placeOrder',
    gracefulStop: '120s',
  };
}

export const options = {
  scenarios,
  // Ngưỡng "luôn đúng" chỉ để k6 xuất số liệu riêng cho từng endpoint trong summary.
  thresholds: {
    'http_req_duration{endpoint:list}': ['p(95)>=0'],
    'http_req_duration{endpoint:place}': ['p(95)>=0'],
    'http_reqs{endpoint:list}': ['count>=0'],
    'http_reqs{endpoint:place}': ['count>=0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

export function listOrders() {
  const page = Math.floor(Math.random() * 20);
  const res = http.get(`${BASE}/orders?page=${page}&mode=${MODE}`, { tags: { endpoint: 'list' }, timeout: '120s' });
  check(res, { 'list 200': (r) => r.status === 200 });
}

export function placeOrder() {
  const res = http.post(`${BASE}/place-order`, null, { tags: { endpoint: 'place' }, timeout: '120s' });
  check(res, { 'place 200': (r) => r.status === 200 });
}

function trend(data, name) {
  const m = data.metrics[name];
  if (!m) return null;
  const v = m.values;
  return { med: v.med, avg: v.avg, p95: v['p(95)'], max: v.max };
}

export function handleSummary(data) {
  const out = {
    name: NAME,
    mode: MODE,
    vus: LIST ? VUS : 0,
    duration: DURATION,
    placeRate: PLACE_RATE,
    list: { ...trend(data, 'http_req_duration{endpoint:list}'), requests: data.metrics['http_reqs{endpoint:list}']?.values.count ?? 0 },
    place: { ...trend(data, 'http_req_duration{endpoint:place}'), requests: data.metrics['http_reqs{endpoint:place}']?.values.count ?? 0 },
    failedRate: data.metrics.http_req_failed?.values.rate ?? 0,
  };
  const round = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);
  const line = (label, t) => (t.requests ? `${label}: ${t.requests} req · med ${round(t.med)} ms · p95 ${round(t.p95)} ms · max ${round(t.max)} ms` : null);
  const text = [`== ${NAME} (mode=${MODE}, vus=${out.vus}, place=${PLACE_RATE}/s, ${DURATION})`, line('list ', out.list), line('place', out.place), `failed: ${round(out.failedRate * 100)} %`]
    .filter(Boolean)
    .join('\n');
  return { stdout: text + '\n', [`bench/results/${NAME}.json`]: JSON.stringify(out, null, 2) };
}
