// Overhead của logging trên gateway: POST /topups (gateway → topup → ledger + BullMQ; bank-adapter → ledger chạy nền).
// MODE=open: tốc độ cố định (p95/p99); MODE=closed: số VU cố định gửi nối tiếp (thông lượng tối đa).
// Dữ liệu tổng hợp: dải số 09000000xx, số thẻ thử nghiệm công khai; ngân hàng luôn OK.
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://gateway:3100';
const open = (__ENV.MODE || 'open') === 'open';
const CARDS = ['4111111111111111', '5555555555554444'];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    main: open
      ? { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 300), timeUnit: '1s', duration: __ENV.DURATION || '30s', preAllocatedVUs: 100, maxVUs: 400 }
      : { executor: 'constant-vus', vus: Number(__ENV.VUS || 32), duration: __ENV.DURATION || '20s' },
  },
};

export default function () {
  const n = Math.floor(Math.random() * 100);
  const phone = `09000000${String(n).padStart(2, '0')}`;
  const body = JSON.stringify({
    customer: { phone, name: 'Khach Tong Hop', contact: { phone } },
    amount: 100000 * (1 + (n % 5)),
    bank_code: 'SIMBANK_OK',
    payment: { card: { number: CARDS[n % 2], holder: 'KHACH TONG HOP', cvv: '123' } },
  });
  http.post(`${BASE}/topups`, body, {
    headers: { 'content-type': 'application/json', 'x-msisdn': `84${phone.slice(1)}` },
    tags: { name: 'POST /topups' },
    timeout: '10s',
  });
}
