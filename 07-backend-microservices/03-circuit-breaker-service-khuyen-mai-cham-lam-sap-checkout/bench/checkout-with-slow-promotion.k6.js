// Checkout ở tốc độ cố định (mô hình mở). Chia số đo theo giai đoạn của sự cố, tính từ lúc bắt đầu lượt:
// before (trước OUTAGE_AT), outage (OUTAGE_AT tới RECOVER_AT), settled (phần outage sau SETTLE_SECONDS đầu), after (sau RECOVER_AT).
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
const RATE = Number(__ENV.RATE ?? 25);
const DURATION = __ENV.DURATION ?? '5m';
const OUTAGE_AT = Number(__ENV.OUTAGE_AT ?? 60) * 1000;
const RECOVER_AT = Number(__ENV.RECOVER_AT ?? 240) * 1000;
const SETTLE_MS = Number(__ENV.SETTLE_SECONDS ?? 15) * 1000;

const PHASES = ['before', 'outage', 'settled', 'after'];
const duration = Object.fromEntries(PHASES.map((p) => [p, new Trend(`checkout_${p}`, true)]));
const ok = Object.fromEntries(PHASES.map((p) => [p, new Counter(`ok_${p}`)]));
const failed = Object.fromEntries(PHASES.map((p) => [p, new Counter(`failed_${p}`)]));
const fallback = Object.fromEntries(PHASES.map((p) => [p, new Counter(`fallback_${p}`)]));

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    checkout: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      // Bản "trước" giữ request tới 40 giây: 25 request/giây cần cỡ 1.000 VU đang chờ (nhật ký 08/02 điểm 3).
      preAllocatedVUs: 1200,
      maxVUs: 2500,
    },
  },
};

function phasesAt(startedMs) {
  if (startedMs < OUTAGE_AT) {
    return ['before'];
  }
  if (startedMs >= RECOVER_AT) {
    return ['after'];
  }
  return startedMs >= OUTAGE_AT + SETTLE_MS ? ['outage', 'settled'] : ['outage'];
}

export default function checkout() {
  // Xếp request vào giai đoạn theo lúc bắt đầu, không theo lúc kết thúc.
  const phases = phasesAt(exec.instance.currentTestRunDuration);
  const i = exec.scenario.iterationInTest;
  const response = http.post(
    `${BASE_URL}/checkout`,
    JSON.stringify({ cartId: `C-${i}`, subtotalVnd: 100000 }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /checkout' }, timeout: '40s' },
  );
  const success = response.status === 200;
  const usedFallback = success && response.json('promotionUnavailable') === true;
  for (const phase of phases) {
    duration[phase].add(response.timings.duration);
    (success ? ok : failed)[phase].add(1);
    if (usedFallback) {
      fallback[phase].add(1);
    }
  }
}
