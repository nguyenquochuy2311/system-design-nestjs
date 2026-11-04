// Tạo đơn ở tốc độ cố định (mô hình mở), đồng thời chạy báo cáo đều đặn nếu REPORT_MODE là plain hoặc lock.
// Cùng endpoint và cùng body cho hai bản, chỉ khác ORDER_URL, SHIPPING_URL. Số đơn đạt và lỗi đếm riêng để đọc khi có migration.
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const ORDER_URL = __ENV.ORDER_URL;
const SHIPPING_URL = __ENV.SHIPPING_URL;
const RATE = Number(__ENV.RATE ?? 30);
const DURATION = __ENV.DURATION ?? '2m';
const REPORT_MODE = __ENV.REPORT_MODE ?? 'none';

const orderDuration = new Trend('order_duration', true);
const orderOk = new Counter('order_ok');
const orderFailed = new Counter('order_failed');
const reportDuration = new Trend('report_duration', true);

const scenarios = {
  orders: {
    executor: 'constant-arrival-rate',
    exec: 'createOrder',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    // Đủ chỗ cho số request dồn lại khi một lượt khóa giữ bảng vài giây (nhật ký 08/02 điểm 3).
    preAllocatedVUs: 600,
    maxVUs: 1500,
  },
};

if (REPORT_MODE !== 'none') {
  scenarios.report = {
    executor: 'constant-arrival-rate',
    exec: 'runReport',
    rate: 4,
    timeUnit: '1m',
    duration: DURATION,
    preAllocatedVUs: 4,
    maxVUs: 8,
  };
}

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios,
};

export function createOrder() {
  const i = 1 + (__ITER % 100);
  const response = http.post(
    `${ORDER_URL}/orders`,
    JSON.stringify({
      shopId: `SHOP-${i}`,
      address: `${i} Lê Lợi, Phường ${i % 20}, Quận ${i % 12}`,
      deliveryWindow: '08:00-12:00',
      zoneCode: `Z${i}`,
      totalVnd: 150000,
      items: [{ sku: `SKU-${i}`, quantity: 1 }],
    }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /orders' }, timeout: '30s' },
  );
  if (response.status === 201) {
    orderOk.add(1);
    orderDuration.add(response.timings.duration);
  } else {
    orderFailed.add(1);
  }
}

export function runReport() {
  const response = http.post(`${SHIPPING_URL}/reports/delivery-success?mode=${REPORT_MODE}`, null, {
    tags: { name: 'POST /reports/delivery-success' },
    timeout: '60s',
  });
  if (response.status === 200) {
    reportDuration.add(response.timings.duration);
  }
}
