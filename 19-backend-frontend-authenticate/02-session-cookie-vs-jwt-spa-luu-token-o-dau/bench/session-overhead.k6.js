// Đo p95 độ trễ của một GET đã xác thực: /truoc/me (JWT verify, không IO) so với /sau/me (tra phiên ở Redis mỗi
// request + gia hạn TTL). Một endpoint mỗi lần chạy; tag `name` cố định (nhật ký 02/02 điểm 1).
import http from 'k6/http';
import { check } from 'k6';

const ENDPOINT = __ENV.ENDPOINT; // 'truoc' | 'sau'
const BASE = __ENV.BASE || 'http://127.0.0.1:3100';
const MODEL = __ENV.MODEL || 'arrival'; // 'arrival' (constant-arrival-rate) | 'closed' (1 VU nối tiếp)

export const options = {
  scenarios:
    MODEL === 'closed'
      ? { s: { executor: 'constant-vus', vus: 1, duration: __ENV.DURATION || '30s' } }
      : {
          s: {
            executor: 'constant-arrival-rate',
            rate: Number(__ENV.RATE || 200),
            timeUnit: '1s',
            duration: __ENV.DURATION || '30s',
            preAllocatedVUs: Number(__ENV.VUS || 80),
            maxVUs: Number(__ENV.MAXVUS || 250),
          },
        },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const url = `${BASE}/${ENDPOINT}/me`;
const params =
  ENDPOINT === 'truoc'
    ? { headers: { Authorization: `Bearer ${__ENV.TOKEN}` }, tags: { name: 'GET /truoc/me' } }
    : { headers: { Cookie: __ENV.SID_COOKIE }, tags: { name: 'GET /sau/me' } };

export default function () {
  const r = http.get(url, params);
  check(r, { '200': (x) => x.status === 200 });
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_OUT]: JSON.stringify(data) };
}
