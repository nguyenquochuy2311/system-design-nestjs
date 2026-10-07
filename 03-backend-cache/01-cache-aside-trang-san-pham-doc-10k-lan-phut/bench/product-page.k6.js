// Tải trang sản phẩm theo mô hình mở (constant-arrival-rate): RATE request/phút dù server đang chậm (không coordinated omission).
// HOT_SHARE (mặc định 80 %) request rơi vào HOT_COUNT (500) id nóng, phần còn lại rải đều trên PRODUCTS (200.000) id.
// Script đo bench/run-load.ts gọi file này; chạy tay:
//   k6 run -e VARIANT=sau -e RATE=10000 -e DURATION=60s -e OUT=bench/results/trial/k6.json bench/product-page.k6.js
// PHASES="normal:<epoch ms>,stop:<epoch ms>,..." gắn mỗi request vào pha đang diễn ra lúc request bắt đầu (diễn tập Redis dừng).
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const VARIANT = __ENV.VARIANT || 'sau';
const RATE = Number(__ENV.RATE || 10000);
const DURATION = __ENV.DURATION || '10m';
const PRODUCTS = Number(__ENV.PRODUCTS || 200000);
const HOT_COUNT = Number(__ENV.HOT_COUNT || 500);
const HOT_SHARE = Number(__ENV.HOT_SHARE || 0.8);
const EDGE_MS = Number(__ENV.EDGE_MS || 3000);
const OUT = __ENV.OUT || 'bench/results/k6-summary.json';
const PHASES = (__ENV.PHASES || '')
  .split(',')
  .filter(Boolean)
  .map((p) => {
    const [name, at] = p.split(':');
    return { name, at: Number(at) };
  });

export const options = {
  discardResponseBodies: true, // header X-Cache vẫn còn; bỏ body để k6 không tốn CPU trên cùng máy với API
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    page: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1m',
      duration: DURATION,
      // Cấp sẵn đủ VU cho request dồn lại khi server khựng (≈ 167 request/giây × 1 giây), tạo VU giữa chừng chậm
      // làm k6 bỏ lượt (nhật ký quyết định, bài 08/02); kiểm dropped_iterations = 0 trước khi dùng số.
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
};

// Độ trễ theo nguồn câu trả lời (header X-Cache của bản sau) và theo pha của diễn tập.
const bySource = {};
for (const s of ['HIT', 'MISS', 'BYPASS', 'NEGATIVE-HIT', 'NONE']) bySource[s] = new Trend(`page_${s.toLowerCase().replace('-', '_')}_ms`, true);
const byPhase = {};
const non200ByPhase = {};
for (const p of PHASES) {
  byPhase[p.name] = new Trend(`phase_${p.name}_ms`, true); // không gồm EDGE_MS đầu pha (lúc lệnh docker đang chạy)
  byPhase[`${p.name}_edge`] = new Trend(`phase_${p.name}_edge_ms`, true);
  non200ByPhase[p.name] = new Counter(`phase_${p.name}_non200`);
}
const non200 = new Counter('page_non200');
const server5xx = new Counter('page_5xx');

// 500 id nóng rải khắp bảng (1 + i·7919 mod PRODUCTS, 7919 nguyên tố cùng nhau với 200.000) thay vì 500 id đầu.
const hotIds = Array.from({ length: HOT_COUNT }, (_, i) => 1 + ((i * 7919) % PRODUCTS));
const pickId = () => (Math.random() < HOT_SHARE ? hotIds[Math.floor(Math.random() * HOT_COUNT)] : 1 + Math.floor(Math.random() * PRODUCTS));

function phaseOf(startedAt) {
  let current = null;
  for (const p of PHASES) if (startedAt >= p.at) current = p;
  if (!current) return null;
  return { name: current.name, edge: startedAt - current.at < EDGE_MS };
}

export default function () {
  const startedAt = Date.now();
  const res = http.get(`${BASE_URL}/${VARIANT}/products/${pickId()}`, {
    tags: { name: `GET /${VARIANT}/products/:id` }, // tên cố định: không tạo một chuỗi số liệu cho mỗi id (bài 02/02)
    timeout: '10s',
  });
  const ok = check(res, { 'trang sản phẩm 200': (r) => r.status === 200 });
  if (!ok) non200.add(1);
  if (res.status >= 500 || res.status === 0) server5xx.add(1);
  if (ok) bySource[res.headers['X-Cache'] || 'NONE'].add(res.timings.duration);
  const phase = phaseOf(startedAt);
  if (phase) {
    if (!ok) non200ByPhase[phase.name].add(1);
    else byPhase[phase.edge ? `${phase.name}_edge` : phase.name].add(res.timings.duration);
  }
}

export function handleSummary(data) {
  const pick = (name) => (data.metrics[name] ? data.metrics[name].values : null);
  const metrics = {};
  for (const name of Object.keys(data.metrics)) {
    if (/^(http_req_duration|http_reqs|http_req_failed|dropped_iterations|iterations|vus_max|checks|page_|phase_)/.test(name)) metrics[name] = data.metrics[name].values;
  }
  const out = { variant: VARIANT, rate: RATE, duration: DURATION, products: PRODUCTS, hotCount: HOT_COUNT, hotShare: HOT_SHARE, phases: PHASES, metrics };
  const d = pick('http_req_duration') || {};
  const line = `${VARIANT}: ${pick('http_reqs')?.count ?? 0} req · p50 ${d.med?.toFixed(2)} · p95 ${d['p(95)']?.toFixed(2)} · p99 ${d['p(99)']?.toFixed(2)} ms · non200 ${pick('page_non200')?.count ?? 0} · dropped ${pick('dropped_iterations')?.count ?? 0}`;
  return { stdout: line + '\n', [OUT]: JSON.stringify(out, null, 2) };
}
