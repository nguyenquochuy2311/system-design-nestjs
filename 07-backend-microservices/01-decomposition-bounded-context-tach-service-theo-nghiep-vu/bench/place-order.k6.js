// Đặt hàng ở tốc độ cố định (mô hình mở) cho cả hai bản: cùng endpoint POST /orders, cùng body, chỉ khác BASE_URL.
// Mỗi đơn 2 SKU; khách và SKU tính từ số thứ tự lượt lặp nên hai bản nhận đúng cùng một chuỗi request.
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL;
const RATE = Number(__ENV.RATE ?? 50);
const DURATION = __ENV.DURATION ?? '5m';
const SEED_SIZE = 1000;

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    place_order: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
};

const pad = (n) => String(n).padStart(4, '0');

export default function placeOrder() {
  const i = exec.scenario.iterationInTest;
  const first = ((i * 7) % SEED_SIZE) + 1;
  const second = (first % SEED_SIZE) + 1;
  const body = JSON.stringify({
    customerId: `KH-${pad((i % SEED_SIZE) + 1)}`,
    items: [
      { sku: `SKU-${pad(first)}`, quantity: 1 },
      { sku: `SKU-${pad(second)}`, quantity: 2 },
    ],
  });
  const response = http.post(`${BASE_URL}/orders`, body, {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'POST /orders' },
  });
  check(response, { 'đặt được hàng': (r) => r.status === 201 });
}
