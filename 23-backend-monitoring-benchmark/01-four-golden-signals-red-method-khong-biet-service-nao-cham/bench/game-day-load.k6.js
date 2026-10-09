// Tải "khách thật" cho game day: đặt hàng và xem đơn qua gateway, mô hình mở (tốc độ cố định) để tải không giảm khi
// hệ thống chậm. Tag `name` cố định cho URL có id (nhật ký 02/02 điểm 1).
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://gateway:3100';
const DURATION = __ENV.DURATION || '60s';
const ORDER = JSON.stringify({ customerId: 7, items: [{ sku: 'SKU-1', qty: 2, price: 150000 }], code: 'SALE10' });

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    // preAllocatedVUs >= tốc độ × timeout 5 s của gateway (nhật ký 08/02 điểm 3) để không bỏ lượt khi hệ thống treo.
    order: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE_POST || 20), timeUnit: '1s', duration: DURATION, preAllocatedVUs: 150, maxVUs: 300, exec: 'order' },
    view: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE_GET || 10), timeUnit: '1s', duration: DURATION, preAllocatedVUs: 80, maxVUs: 160, exec: 'view' },
  },
};

export function order() {
  http.post(`${BASE}/checkout`, ORDER, { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /checkout' }, timeout: '10s' });
}

export function view() {
  http.get(`${BASE}/orders/${1 + Math.floor(Math.random() * 1000)}`, { tags: { name: 'GET /orders/:id' }, timeout: '10s' });
}
