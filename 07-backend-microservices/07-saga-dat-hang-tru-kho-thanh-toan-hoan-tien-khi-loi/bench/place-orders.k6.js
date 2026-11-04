// Đặt hàng ở tốc độ cố định (mô hình mở) cho cả hai bản. Bản trước trả 200, 402 hoặc 409 sau cả quy trình; bản sau trả 202.
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
const RATE = Number(__ENV.RATE ?? 30);
const DURATION = __ENV.DURATION ?? '334s';

const accepted = new Trend('order_accepted_duration', true);
const unavailable = new Counter('order_unavailable');

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
};

export default function placeOrder() {
  const i = exec.scenario.iterationInTest;
  const response = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ sku: `SKU-${String((i % 1000) + 1).padStart(4, '0')}`, quantity: 1, amountVnd: 300000 }),
    {
      headers: { 'content-type': 'application/json' },
      tags: { name: 'POST /orders' },
      timeout: '15s',
      responseCallback: http.expectedStatuses(200, 202, 402, 409),
    },
  );
  // Tiến trình bị kill thì request đang bay mất kết nối: đếm riêng, không tính vào độ trễ.
  if ([200, 202, 402, 409].includes(response.status)) {
    accepted.add(response.timings.duration);
  } else {
    unavailable.add(1);
  }
}
