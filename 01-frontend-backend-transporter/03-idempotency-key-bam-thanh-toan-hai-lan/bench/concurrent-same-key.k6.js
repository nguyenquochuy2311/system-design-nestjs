// 20 VU bắn cùng lúc một request giống hệt nhau (cùng người dùng, cùng payload, cùng Idempotency-Key), lặp ROUNDS vòng.
// Các VU canh cùng một mốc đồng hồ (bội số của PERIOD_MS) trước mỗi vòng để request đi ra gần như đồng thời.
// Chạy qua bench/run-concurrent.ts; đếm giao dịch trong PostgreSQL theo mã ý định (note).
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

const VARIANT = __ENV.VARIANT ?? 'sau';
const ROUNDS = Number(__ENV.ROUNDS ?? 50);
const PERIOD_MS = Number(__ENV.PERIOD_MS ?? 300);
const PREFIX = __ENV.PREFIX ?? 'k6';
const BASE = __ENV.BASE ?? 'http://127.0.0.1:3100';

export const options = {
  scenarios: {
    same_key: { executor: 'per-vu-iterations', vus: Number(__ENV.VUS ?? 20), iterations: ROUNDS, maxDuration: '5m' },
  },
  summaryTrendStats: ['med', 'p(95)', 'max'],
};

const s201 = new Counter('status_201');
const s409 = new Counter('status_409');
const sOther = new Counter('status_other');
const replayed = new Counter('replayed');

export default function () {
  sleep((PERIOD_MS - (Date.now() % PERIOD_MS)) / 1000);
  const round = Math.floor(Date.now() / PERIOD_MS);
  const userId = String(1 + (round % 10000));
  const note = `${PREFIX}-${VARIANT}-${round}`;
  const res = http.post(`${BASE}/${VARIANT}/payments`, JSON.stringify({ merchantId: 9, amount: 1000, note }), {
    headers: { 'content-type': 'application/json', 'x-user-id': userId, 'idempotency-key': `"${note}"` },
    tags: { name: `POST /${VARIANT}/payments` },
  });
  if (res.status === 201) s201.add(1);
  else if (res.status === 409) s409.add(1);
  else sOther.add(1);
  if (res.headers['Idempotent-Replayed'] === 'true') replayed.add(1);
}

export function handleSummary(data) {
  const count = (m) => data.metrics[m]?.values.count ?? 0;
  const out = {
    variant: VARIANT, rounds: ROUNDS, periodMs: PERIOD_MS, vus: Number(__ENV.VUS ?? 20),
    requests: count('http_reqs'), status201: count('status_201'), status409: count('status_409'), statusOther: count('status_other'),
    replayed: count('replayed'), durationMs: data.metrics.http_req_duration?.values,
  };
  return { [__ENV.OUT]: JSON.stringify(out, null, 2), stdout: `${JSON.stringify(out)}\n` };
}
