// Độ trễ POST /<VARIANT>/orders: bản "trước" (logic trong controller) so với "sau" (controller → service → repository).
// Chạy qua bench/http-overhead.ts (tự bật API, xoay thứ tự, xóa bảng đơn giữa các lượt). Chạy tay:
//   k6 run -e VARIANT=sau -e CUSTOMERS=1,2,3 -e PRODUCTS=1,2,3 bench/place-order.k6.js
import http from 'k6/http';
import { check } from 'k6';

const VARIANT = __ENV.VARIANT || 'sau';
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const CUSTOMERS = (__ENV.CUSTOMERS || '').split(',').map(Number);
const PRODUCTS = (__ENV.PRODUCTS || '').split(',').map(Number);

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '20s',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default function () {
  const lines = 1 + Math.floor(Math.random() * 5);
  const items = [];
  for (let i = 0; i < lines; i++) items.push({ productId: pick(PRODUCTS), quantity: 1 + Math.floor(Math.random() * 10) });
  const res = http.post(`${BASE_URL}/${VARIANT}/orders`, JSON.stringify({ customerId: pick(CUSTOMERS), items }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: `POST /${VARIANT}/orders` }, // tên cố định: một chuỗi số liệu cho mỗi endpoint (bài 02/02)
  });
  check(res, { 'status 201': (r) => r.status === 201 });
}
