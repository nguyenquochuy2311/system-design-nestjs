// Mở màn hình chi tiết đơn ở tốc độ cố định (mô hình mở). Bản trước làm đúng như client cũ: 4 lời gọi tuần tự, một lỗi là lỗi
// toàn trang. Bản sau: một request tới BFF. Đo theo "màn hình" chứ không theo từng request.
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const VARIANT = __ENV.VARIANT;
const RATE = Number(__ENV.RATE ?? 30);
const DURATION = __ENV.DURATION ?? '5m';
const SEED_ORDERS = 10000;

const pageDuration = new Trend('page_duration', true);
const pageOk = new Counter('page_ok');
const pagePartial = new Counter('page_partial');
const pageFailed = new Counter('page_failed');

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    open_order: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
};

const get = (url, name) => http.get(url, { tags: { name }, timeout: '2s' });

function legacyPage(orderId) {
  const order = get(`http://order-service:3000/orders/${orderId}`, 'GET /orders/:id');
  if (order.status !== 200) {
    return false;
  }
  const payment = get(`http://payment-service:3000/payments/${orderId}`, 'GET /payments/:id');
  const shipping = get(`http://toxiproxy:18080/shipments/${orderId}`, 'GET /shipments/:id');
  const customer = get(`http://customer-service:3000/customers/${order.json('customer_id')}`, 'GET /customers/:id');
  return payment.status === 200 && shipping.status === 200 && customer.status === 200;
}

function composedPage(orderId) {
  const response = http.get(`http://bff:3000/order-details/${orderId}`, {
    headers: { 'x-user-id': 'NV-1', 'x-user-role': 'support' },
    tags: { name: 'GET /order-details/:id' },
    timeout: '2s',
  });
  if (response.status !== 200) {
    return false;
  }
  if (response.json('partial').length > 0) {
    pagePartial.add(1);
  }
  return true;
}

export default function openOrder() {
  const orderId = `DH-${(exec.scenario.iterationInTest % SEED_ORDERS) + 1}`;
  const startedAt = Date.now();
  const shown = VARIANT === 'truoc' ? legacyPage(orderId) : composedPage(orderId);
  pageDuration.add(Date.now() - startedAt);
  (shown ? pageOk : pageFailed).add(1);
}
