// Tải nền của nhân viên cửa hàng trong lúc kế toán xuất Excel: tạo đơn đều đặn RATE đơn/giây (mô hình mở:
// request tới theo lịch dù server đang treo, không bị coordinated omission) và health check 2 lần/giây, timeout 2 giây
// như load balancer. Export do bench/export-while-ordering.ts kích hoạt, script này chỉ tạo tải nền.
//   k6 run -e RATE=50 -e DURATION=60s -e BASE_URL=http://127.0.0.1:3100 bench/export-while-ordering.k6.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '60s';
const TENANT_ID = Number(__ENV.TENANT_ID || 2);

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      exec: 'createOrder',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 400, // cấp sẵn: tạo VU giữa chừng chậm làm k6 bỏ lượt (dropped_iterations)
      maxVUs: 2000, // đủ VU cho request dồn lại khi web bị treo nhiều giây
    },
    health: {
      executor: 'constant-arrival-rate',
      exec: 'health',
      rate: 2,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 100,
    },
  },
};

export function createOrder() {
  const items = [];
  const lines = 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < lines; i++) items.push({ price: 10000 * (1 + Math.floor(Math.random() * 50)), quantity: 1 + Math.floor(Math.random() * 5) });
  const res = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ tenantId: TENANT_ID, storeName: 'Cửa hàng số 7', customerName: 'Khách lẻ', customerPhone: '0900000000', items }),
    { headers: { 'content-type': 'application/json' }, timeout: '60s', tags: { name: 'POST /orders' } }, // tên cố định (bài 02/02)
  );
  check(res, { 'tạo đơn 201': (r) => r.status === 201 });
}

export function health() {
  const res = http.get(`${BASE_URL}/health`, { timeout: '2s', tags: { name: 'GET /health' } });
  check(res, { 'health 200 trong 2 s': (r) => r.status === 200 });
}
