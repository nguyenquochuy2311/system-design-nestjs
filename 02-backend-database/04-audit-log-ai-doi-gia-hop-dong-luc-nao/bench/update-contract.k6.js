// Đo độ trễ sửa phí hợp đồng: PATCH /contracts/:id?mode=truoc|sau. Bật / tắt trigger do bench/run-overhead.ts lo.
// Ví dụ: k6 run -e MODE=sau -e VUS=10 -e DURATION=30s -e NAME=overhead-sau-on-r1 bench/update-contract.k6.js
// Biến: MODE=truoc|sau · VUS · DURATION · CONTRACTS (số hợp đồng đã seed) · NAME · BASE_URL · RESULTS_DIR
// Mỗi VU chỉ sửa hợp đồng thuộc "phần" của mình (id ≡ VU mod VUS): không tranh khóa dòng, chênh lệch giữa các
// chế độ là chi phí của cách ghi (transaction + set_config + trigger), không phải thời gian chờ khóa.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const MODE = __ENV.MODE || 'sau';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';
const CONTRACTS = Number(__ENV.CONTRACTS || 40000);
const NAME = __ENV.NAME || `update-${MODE}`;
const RESULTS_DIR = __ENV.RESULTS_DIR || 'bench/results';

export const options = {
  scenarios: { update: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '30s' } },
  thresholds: { 'http_req_duration{endpoint:update}': ['p(95)>=0'] }, // chỉ để k6 xuất số liệu riêng cho endpoint
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function pickId() {
  const slots = Math.floor(CONTRACTS / VUS);
  return 1 + ((__VU - 1) % VUS) + VUS * Math.floor(Math.random() * slots);
}

export default function () {
  const id = pickId();
  const body = JSON.stringify({ premium: 20000000 + Math.floor(Math.random() * 200) * 1000000, reason: 'k6 đo overhead ghi' });
  const res = http.patch(`${BASE}/contracts/${id}?mode=${MODE}`, body, {
    headers: { 'content-type': 'application/json', 'x-user': `k6-${__VU}`, 'x-request-id': `k6-${__VU}-${__ITER}` },
    // name cố định: không để k6 tạo một chuỗi số liệu cho mỗi id (bài 02/02).
    tags: { endpoint: 'update', name: 'PATCH /contracts/:id' },
  });
  check(res, { 'update 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const m = data.metrics['http_req_duration{endpoint:update}'];
  const v = m ? m.values : {};
  const out = {
    name: NAME,
    mode: MODE,
    vus: VUS,
    duration: DURATION,
    requests: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
    failedRate: data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0,
    latency: { avg: v.avg, med: v.med, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max },
  };
  const r = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const text = `== ${NAME} (mode=${MODE}, vus=${VUS}, ${DURATION}): ${out.requests} req · med ${r(v.med)} ms · p95 ${r(v['p(95)'])} ms · p99 ${r(v['p(99)'])} ms · failed ${r(out.failedRate * 100)} %\n`;
  return { stdout: text, [`${RESULTS_DIR}/${NAME}.k6.json`]: JSON.stringify(out, null, 2) };
}
