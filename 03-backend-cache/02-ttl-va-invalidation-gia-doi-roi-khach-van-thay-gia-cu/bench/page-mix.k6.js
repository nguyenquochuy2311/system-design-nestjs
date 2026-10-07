// Tải đọc ba loại trang có giá theo mô hình mở (constant-arrival-rate): RATE request/phút dù server đang chậm.
// Chuỗi request TẤT ĐỊNH theo số thứ tự iteration (hàm băm, không Math.random): hai bản nhận cùng một chuỗi trang,
// nên chênh hit ratio giữa hai bản là do invalidation chứ không do may rủi của phần đuôi.
//   50 % trang chi tiết: 90 % vào 600 sản phẩm nóng (id 1–600), 10 % rải đều 20.000 id
//   40 % trang danh mục: 90 % vào trang 1–5 của 6 danh mục (đúng 600 sản phẩm nóng), 10 % rải đều mọi trang
//   10 % khối "deal hôm nay" ở trang chủ
// Script đo bench/run-scenario.ts gọi file này; chạy tay:
//   k6 run -e VARIANT=sau -e RATE=10000 -e DURATION=60s -e OUT=bench/results/trial/k6.json bench/page-mix.k6.js
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const VARIANT = __ENV.VARIANT || 'sau';
const RATE = Number(__ENV.RATE || 10000);
const DURATION = __ENV.DURATION || '10m';
const PRODUCTS = Number(__ENV.PRODUCTS || 20000);
const SEED = Number(__ENV.SEED || 1);
const OUT = __ENV.OUT || 'bench/results/k6-summary.json';
const CATEGORIES = ['thoi-trang', 'dien-tu', 'gia-dung', 'my-pham', 'phu-kien', 'the-thao'];
const HOT_PRODUCTS = 600;
const HOT_PAGES = 5;
const PAGES = Math.ceil(PRODUCTS / CATEGORIES.length / 20);

export const options = {
  discardResponseBodies: true, // header X-Cache vẫn còn; bỏ body để k6 không tốn CPU trên cùng máy với API
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    pages: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1m',
      duration: DURATION,
      // Cấp sẵn đủ VU cho request dồn lại khi máy khựng (nhật ký quyết định, bài 08/02); kiểm dropped_iterations = 0.
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
};

function hash32(a) {
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d);
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b);
  a ^= a >>> 16;
  return a >>> 0;
}
const rand = (i, salt) => hash32((Math.imul(i, 4) + salt) ^ Math.imul(SEED, 0x9e3779b1)) / 4294967296;

const latency = {};
const non200 = {};
for (const p of ['product', 'category', 'home']) {
  latency[p] = new Trend(`page_${p}_ms`, true);
  non200[p] = new Counter(`page_${p}_non200`);
}
const bySource = {};
for (const s of ['HIT', 'MISS', 'BYPASS']) bySource[s] = new Trend(`source_${s.toLowerCase()}_ms`, true);
const server5xx = new Counter('page_5xx');

function pick(i) {
  const u = rand(i, 1);
  const hot = rand(i, 2) < 0.9;
  const w = rand(i, 3);
  if (u < 0.5) {
    const id = hot ? 1 + Math.floor(w * HOT_PRODUCTS) : 1 + Math.floor(w * PRODUCTS);
    return { page: 'product', url: `/${VARIANT}/products/${id}`, name: `GET /${VARIANT}/products/:id` };
  }
  if (u < 0.9) {
    const category = CATEGORIES[Math.floor(w * CATEGORIES.length)];
    const page = hot ? 1 + Math.floor(rand(i, 4) * HOT_PAGES) : 1 + Math.floor(rand(i, 4) * PAGES);
    return { page: 'category', url: `/${VARIANT}/categories/${category}?page=${page}`, name: `GET /${VARIANT}/categories/:slug` };
  }
  return { page: 'home', url: `/${VARIANT}/home/deals`, name: `GET /${VARIANT}/home/deals` };
}

export default function () {
  const target = pick(exec.scenario.iterationInTest);
  // Tên cố định cho từng loại trang: không tạo một chuỗi số liệu cho mỗi id (bài 02/02).
  const res = http.get(`${BASE_URL}${target.url}`, { tags: { name: target.name, page: target.page }, timeout: '10s' });
  const ok = check(res, { 'trang 200': (r) => r.status === 200 });
  if (!ok) non200[target.page].add(1);
  if (res.status >= 500 || res.status === 0) server5xx.add(1);
  if (ok) {
    latency[target.page].add(res.timings.duration);
    const source = res.headers['X-Cache'];
    if (bySource[source]) bySource[source].add(res.timings.duration);
  }
}

export function handleSummary(data) {
  const metrics = {};
  for (const name of Object.keys(data.metrics)) {
    if (/^(http_req_duration|http_reqs|http_req_failed|dropped_iterations|iterations|vus_max|checks|page_|source_)/.test(name)) metrics[name] = data.metrics[name].values;
  }
  const d = (data.metrics.http_req_duration || {}).values || {};
  const count = (n) => ((data.metrics[n] || {}).values || {}).count || 0;
  const line = `${VARIANT}: ${count('http_reqs')} req · p50 ${d.med?.toFixed(2)} · p95 ${d['p(95)']?.toFixed(2)} · p99 ${d['p(99)']?.toFixed(2)} ms · dropped ${count('dropped_iterations')}`;
  return { stdout: line + '\n', [OUT]: JSON.stringify({ variant: VARIANT, rate: RATE, duration: DURATION, products: PRODUCTS, seed: SEED, metrics }, null, 2) };
}
