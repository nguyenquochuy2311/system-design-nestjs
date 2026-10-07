// Tải "khách xem trang" qua CDN mô phỏng: mỗi iteration là MỘT lượt xem trang của một khách, tải đủ những gì trình
// duyệt tải: HTML, file /_next/static mà HTML trỏ tới, JSON (danh sách hoặc sản phẩm), giỏ hàng (có cookie), rồi ảnh
// trong JSON. Mỗi khách có cache riêng (bench/browser-cache.js) nên khách quay lại chỉ gửi những request mà trình duyệt
// gửi: dùng bản lưu còn fresh, hỏi lại bằng If-None-Match khi hết hạn.
//
// Mô hình mở (constant-arrival-rate): VIEWS_PER_S lượt xem mỗi giây trong DURATION. RETURN_SHARE lượt xem là của khách
// đã ghé trong lượt đo (chọn trong các khách mà VU này đã phục vụ); còn lại là khách mới với cache trống. Trang chọn đều
// trong 4 danh mục (60 %) và 96 sản phẩm (40 %), không phụ thuộc khách đã xem gì.
// Header X-Visit (Nginx ghi vào log): "repeat" khi khách này đã xem đúng trang này trước đó (lượt xem lặp lại theo nghĩa
// của README mục 5), "first" khi chưa — kể cả khách quay lại nhưng mở trang mới.
// Lượt chọn khách / trang tất định theo iterationInTest (nhật ký quyết định bài 03/02), không dùng Math.random.
//
// CHECK=1: một VU, 2 lượt xem cùng trang của cùng một khách (lần đầu, lần lặp lại), in từng quyết định cache ra console
// để bench/browser-bytes.ts đối chiếu với Chrome thật.
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { BrowserCache, header, staticAssetsIn } from './browser-cache.js';

const BASE = __ENV.BASE || 'http://127.0.0.1:58088';
const CHECK = __ENV.CHECK === '1';
const VIEWS_PER_S = Number(__ENV.VIEWS_PER_S || 10);
const DURATION = __ENV.DURATION || '6m';
const RETURN_SHARE = Number(__ENV.RETURN_SHARE || 0.7);
const PRODUCT_SHARE = Number(__ENV.PRODUCT_SHARE || 0.4);
const SECRET = __ENV.SESSION_SECRET || 'lab-only-session-secret';
const CATEGORIES = ['dien-thoai', 'laptop', 'tai-nghe', 'dong-ho'];
const PRODUCT_COUNT = 96;

// Header Chrome gửi cho từng loại request (Chrome 154 trên macOS, đọc từ CDP trong bench/results/*/bytes-*.json).
const AE = 'gzip, deflate, br, zstd';
const ACCEPT = {
  html: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  static: '*/*',
  css: 'text/css,*/*;q=0.1',
  json: '*/*',
  image: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

export const options = CHECK
  ? { scenarios: { check: { executor: 'per-vu-iterations', vus: 1, iterations: 2 } } }
  : {
      discardResponseBodies: false,
      summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
      scenarios: {
        views: {
          executor: 'constant-arrival-rate',
          rate: VIEWS_PER_S,
          timeUnit: '1s',
          duration: DURATION,
          preAllocatedVUs: Number(__ENV.VUS || 200),
          maxVUs: Number(__ENV.VUS || 200),
        },
      },
    };

const views = new Counter('page_views');
const repeatViews = new Counter('repeat_page_views');
const cacheUse = new Counter('browser_cache_use');
const conditionalSent = new Counter('conditional_requests');
const notModified = new Counter('responses_304');
const cartLeak = new Counter('cart_leak');
const badStatus = new Counter('bad_status');

// Khách mà VU này đã phục vụ (trạng thái của VU tồn tại qua các iteration).
const visitors = [];

/** Số giả ngẫu nhiên tất định trong [0, 1) từ số thứ tự iteration. `>>> 0` sau mỗi phép: `^` của JS trả int32 có dấu. */
function hash01(n, salt) {
  let x = (Math.imul(n, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

function sessionCookie(userId) {
  const sig = crypto.hmac('sha256', SECRET, String(userId), 'base64rawurl').slice(0, 22);
  return `sid=u${userId}.${sig}`;
}

function newVisitor() {
  const userId = exec.vu.idInTest * 100000 + visitors.length + 1;
  const v = { userId, cookie: sessionCookie(userId), cache: new BrowserCache(), seen: {} };
  visitors.push(v);
  return v;
}

/** Chuẩn bị một request theo cache của khách: null nếu dùng bản lưu (không request). */
function prepare(visitor, url, kind, name, visit, plan) {
  const d = visitor.cache.lookup(url, Date.now());
  if (CHECK) console.log(JSON.stringify({ visit, url, action: d.action, conditional: d.headers || null }));
  if (d.action === 'use') {
    cacheUse.add(1, { name });
    plan.push({ url, cached: true, body: d.body, name });
    return;
  }
  const headers = Object.assign({ Accept: ACCEPT[kind], 'Accept-Encoding': AE, Cookie: visitor.cookie, 'X-Visit': visit }, d.headers || {});
  if (d.headers) conditionalSent.add(1, { name });
  plan.push({ url, cached: false, name, req: { method: 'GET', url: BASE + url, params: { headers, tags: { name, visit } } } });
}

/** Gửi song song (như trình duyệt mở nhiều kết nối) rồi cập nhật cache; trả body theo thứ tự plan. */
function run(visitor, plan) {
  const reqs = plan.filter((p) => !p.cached).map((p) => p.req);
  const responses = reqs.length ? http.batch(reqs) : [];
  let i = 0;
  return plan.map((p) => {
    if (p.cached) return p.body;
    const res = responses[i++];
    if (res.status === 304) notModified.add(1, { name: p.name });
    if (res.status !== 200 && res.status !== 304) badStatus.add(1, { name: p.name, status: String(res.status) });
    const keepBody = p.name === 'html' || p.name.startsWith('api-');
    return visitor.cache.update(p.url, res.status, res.headers, keepBody ? res.body : null, Date.now());
  });
}

function pageView(visitor, page, returning) {
  const visit = visitor.seen[page.path] ? 'repeat' : 'first';
  visitor.seen[page.path] = true;
  views.add(1, { visit, visitor: returning ? 'returning' : 'new', page: page.kind });
  if (visit === 'repeat') repeatViews.add(1);
  // 1. HTML
  const htmlPlan = [];
  prepare(visitor, page.path, 'html', 'html', visit, htmlPlan);
  const [html] = run(visitor, htmlPlan);
  // 2. file tĩnh của HTML + JSON mà trang gọi khi chạy + giỏ hàng
  const plan = [];
  for (const a of staticAssetsIn(html)) prepare(visitor, a, a.endsWith('.css') ? 'css' : 'static', 'static', visit, plan);
  prepare(visitor, page.json, 'json', page.kind === 'catalog' ? 'api-products' : 'api-product', visit, plan);
  prepare(visitor, '/api/cart/summary', 'json', 'api-cart-summary', visit, plan);
  const bodies = run(visitor, plan);
  const json = bodies[bodies.length - 2];
  const cart = bodies[bodies.length - 1];
  try {
    if (cart && JSON.parse(cart).userId !== visitor.userId) cartLeak.add(1);
  } catch (e) {
    badStatus.add(1, { name: 'api-cart-summary', status: 'parse' });
  }
  // 3. ảnh trong JSON
  let images = [];
  try {
    const data = JSON.parse(json);
    images = page.kind === 'catalog' ? data.map((p) => p.images.thumb) : [data.images.large];
  } catch (e) {
    badStatus.add(1, { name: page.kind, status: 'parse' });
  }
  const imgPlan = [];
  for (const src of images) prepare(visitor, src, 'image', page.kind === 'catalog' ? 'media-thumb' : 'media-large', visit, imgPlan);
  run(visitor, imgPlan);
}

export default function () {
  if (CHECK) {
    const visitor = visitors[0] || newVisitor();
    pageView(visitor, { kind: 'catalog', path: '/danh-muc/dien-thoai', json: '/api/products?category=dien-thoai' }, exec.vu.iterationInScenario > 0);
    return;
  }
  const n = exec.scenario.iterationInTest;
  const returning = hash01(n, 1) < RETURN_SHARE && visitors.length > 0;
  const visitor = returning ? visitors[Math.floor(hash01(n, 2) * visitors.length)] : newVisitor();
  let page;
  if (hash01(n, 3) < PRODUCT_SHARE) {
    const id = 1 + Math.floor(hash01(n, 4) * PRODUCT_COUNT);
    page = { kind: 'product', path: `/san-pham/${id}`, json: `/api/products/${id}` };
  } else {
    const slug = CATEGORIES[Math.floor(hash01(n, 5) * CATEGORIES.length)];
    page = { kind: 'catalog', path: `/danh-muc/${slug}`, json: `/api/products?category=${slug}` };
  }
  pageView(visitor, page, returning);
}

export function handleSummary(data) {
  const out = { stdout: '' };
  if (__ENV.SUMMARY_FILE) out[__ENV.SUMMARY_FILE] = JSON.stringify(data, null, 2);
  return out;
}
