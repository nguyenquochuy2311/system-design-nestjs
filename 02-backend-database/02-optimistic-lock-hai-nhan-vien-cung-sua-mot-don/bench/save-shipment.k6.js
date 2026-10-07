// Đo độ trễ lưu vận đơn: mở (GET) rồi lưu (PATCH) với version vừa đọc.
// Ví dụ: k6 run -e MODE=version -e VUS=10 -e DURATION=30s -e NAME=save-version-r1 bench/save-shipment.k6.js
// Biến: MODE=lww|for-update|check-then-write|version · VUS · DURATION · SHIPMENTS (số vận đơn đã seed) · HOT · NAME · BASE_URL
// HOT=0 (mặc định): mỗi VU chỉ sửa vận đơn thuộc "phần" của mình (id ≡ VU mod VUS) => không có xung đột,
//   chênh lệch giữa các MODE là overhead thuần của cách lưu.
// HOT=n: mọi VU sửa ngẫu nhiên trong n vận đơn đầu => tranh chấp thật, đếm tỉ lệ 409.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const MODE = __ENV.MODE || 'version';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';
const SHIPMENTS = Number(__ENV.SHIPMENTS || 10000);
const HOT = Number(__ENV.HOT || 0);
const NAME = __ENV.NAME || `save-${MODE}`;

const conflicts = new Counter('save_conflicts');

export const options = {
  scenarios: { save: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '30s' } },
  // Ngưỡng "luôn đúng" chỉ để k6 xuất số liệu riêng cho từng endpoint trong summary.
  thresholds: {
    'http_req_duration{endpoint:get}': ['p(95)>=0'],
    'http_req_duration{endpoint:save}': ['p(95)>=0'],
    'http_reqs{endpoint:save}': ['count>=0'],
    save_conflicts: ['count>=0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function pickId() {
  if (HOT > 0) return 1 + Math.floor(Math.random() * HOT);
  const slots = Math.floor(SHIPMENTS / VUS);
  return 1 + ((__VU - 1) % VUS) + VUS * Math.floor(Math.random() * slots);
}

export default function () {
  const id = pickId();
  const opened = http.get(`${BASE}/shipments/${id}`, { tags: { endpoint: 'get', name: 'GET /shipments/:id' } });
  if (!check(opened, { 'get 200': (r) => r.status === 200 })) return;
  const s = opened.json();
  const body = JSON.stringify({
    recipientName: s.recipientName,
    address: s.address,
    appointmentAt: s.appointmentAt,
    codCents: s.codCents,
    note: `k6 ${__VU}-${__ITER}`,
    version: s.version,
  });
  const res = http.patch(`${BASE}/shipments/${id}?mode=${MODE}`, body, {
    headers: { 'content-type': 'application/json', 'x-user': `k6-${__VU}` },
    // name cố định để k6 không tạo một chuỗi số liệu cho mỗi id (tốn RAM/CPU, tranh tài nguyên với API trên cùng máy).
    tags: { endpoint: 'save', name: 'PATCH /shipments/:id' },
    // 409 là kết quả hợp lệ của pattern, không tính là request lỗi.
    responseCallback: http.expectedStatuses(200, 409),
  });
  if (res.status === 409) conflicts.add(1);
  check(res, { 'save 200 hoặc 409': (r) => r.status === 200 || r.status === 409 });
}

function trend(data, name) {
  const m = data.metrics[name];
  if (!m) return null;
  const v = m.values;
  return { med: v.med, avg: v.avg, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max };
}

export function handleSummary(data) {
  const saves = data.metrics['http_reqs{endpoint:save}']?.values.count ?? 0;
  const conflictCount = data.metrics.save_conflicts?.values.count ?? 0;
  const out = {
    name: NAME,
    mode: MODE,
    vus: VUS,
    duration: DURATION,
    hot: HOT,
    save: { ...trend(data, 'http_req_duration{endpoint:save}'), requests: saves, conflicts: conflictCount, conflictRate: saves ? conflictCount / saves : 0 },
    get: trend(data, 'http_req_duration{endpoint:get}'),
    failedRate: data.metrics.http_req_failed?.values.rate ?? 0,
  };
  const r = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const text = [
    `== ${NAME} (mode=${MODE}, vus=${VUS}, hot=${HOT}, ${DURATION})`,
    `save: ${saves} req · med ${r(out.save.med)} ms · p95 ${r(out.save.p95)} ms · p99 ${r(out.save.p99)} ms · max ${r(out.save.max)} ms`,
    `409: ${conflictCount} (${r(out.save.conflictRate * 100)} %) · failed: ${r(out.failedRate * 100)} %`,
  ].join('\n');
  return { stdout: text + '\n', [`bench/results/${NAME}.json`]: JSON.stringify(out, null, 2) };
}
