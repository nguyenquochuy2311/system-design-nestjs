// Overhead của instrumentation: GET /orders/:id qua gateway → checkout → DB. MODE=open: tốc độ cố định (p95/p99);
// MODE=closed: số VU cố định, mỗi VU gửi nối tiếp (thông lượng tối đa).
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://gateway:3100';
const open = (__ENV.MODE || 'open') === 'open';

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
  http.get(`${BASE}/orders/${1 + Math.floor(Math.random() * 1000)}`, { tags: { name: 'GET /orders/:id' }, timeout: '10s' });
}
