// Tải chuyển tiền ví: mỗi người dùng ảo (VU) gửi POST /transfers liên tục, không nghỉ, giữa hai ví ngẫu nhiên.
// Thường chạy qua bench/run-step.ts (dựng pod, lấy mẫu kết nối). Chạy tay khi đã có pod (profile pods):
//   docker compose --profile bench run --rm k6 run -e BASE_URL=http://api:3100 -e VUS=200 -e NAME=sau-40 /bench/transfer.k6.js
// Biến: VUS · DURATION_S · WARMUP_S (số liệu "main" bỏ phần warm-up) · WALLETS · NAME · BASE_URL
//       STAGES="60:18,60:60,60:120" (giây:VU) thay cho VUS/DURATION_S để tăng tải theo từng bước, tag phase=s0,s1...
//       RATE=r: tải mở, r request/giây cố định (constant-arrival-rate, tối đa VUS người dùng ảo) thay cho VU gửi liên
//       tục; dùng khi so độ trễ ở mức tải máy còn chịu được (VU gửi liên tục luôn đẩy máy tới bão hòa).
//       CONN_CLOSE_EVERY=n: cứ n lượt gửi "Connection: close" một lần để kết nối xoay vòng sang pod mới thêm
//       (như ingress L7 chia theo request); mặc định 0 = giữ kết nối suốt lượt đo, mỗi VU dính một pod.
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const VUS = Number(__ENV.VUS || 30);
const DURATION_S = Number(__ENV.DURATION_S || 60);
const WARMUP_S = Number(__ENV.WARMUP_S || 10);
const WALLETS = Number(__ENV.WALLETS || 100000);
const NAME = __ENV.NAME || 'transfer';
const CONN_CLOSE_EVERY = Number(__ENV.CONN_CLOSE_EVERY || 0);
const RESULTS_DIR = __ENV.RESULTS_DIR || 'bench/results';
const RATE = Number(__ENV.RATE || 0);
const STAGES = (__ENV.STAGES || '')
  .split(',')
  .filter(Boolean)
  .map((s) => s.split(':').map(Number))
  .map(([seconds, vus]) => ({ seconds, vus }));

// Loại lỗi API trả trong body 503 (src/shared/db-errors.ts) + lỗi mạng (status 0) + 5xx khác.
const KINDS = ['db_too_many_clients', 'db_pool_timeout', 'pooler_wait_timeout', 'pooler_max_client_conn', 'db_unreachable', 'db_connection_lost', 'http_other', 'network'];
const errors = new Counter('transfer_errors');

const PHASES = STAGES.length ? STAGES.map((_, i) => `s${i}`) : ['warmup', 'main'];
const thresholds = {};
for (const p of PHASES) {
  // Ngưỡng "luôn đúng" chỉ để k6 xuất số liệu riêng cho từng giai đoạn trong summary.
  thresholds[`http_req_duration{phase:${p},expected_response:true}`] = ['p(95)>=0'];
  thresholds[`http_reqs{phase:${p}}`] = ['count>=0'];
  thresholds[`http_req_failed{phase:${p}}`] = ['rate>=0'];
  for (const k of KINDS) thresholds[`transfer_errors{phase:${p},kind:${k}}`] = ['count>=0'];
}

export const options = {
  scenarios: STAGES.length
    ? {
        transfer: {
          executor: 'ramping-vus',
          startVUs: STAGES[0].vus,
          // mỗi bước: tăng VU trong 1 giây rồi giữ nguyên tới hết bước
          stages: STAGES.flatMap((s) => [
            { duration: '1s', target: s.vus },
            { duration: `${s.seconds - 1}s`, target: s.vus },
          ]),
          gracefulRampDown: '5s',
        },
      }
    : RATE > 0
      ? {
          transfer: {
            executor: 'constant-arrival-rate',
            rate: RATE,
            timeUnit: '1s',
            duration: `${WARMUP_S + DURATION_S}s`,
            preAllocatedVUs: VUS,
            maxVUs: VUS,
            gracefulStop: '10s',
          },
        }
      : { transfer: { executor: 'constant-vus', vus: VUS, duration: `${WARMUP_S + DURATION_S}s`, gracefulStop: '10s' } },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // http://api:3100 phân giải ra IP của mọi bản sao; mỗi kết nối mới lấy IP kế tiếp (như Service của Kubernetes).
  // ttl ngắn để thấy pod mới thêm khi tăng bước.
  dns: { ttl: '1s', select: 'roundRobin', policy: 'preferIPv4' },
};

function phaseNow() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  if (!STAGES.length) return elapsed < WARMUP_S ? 'warmup' : 'main';
  let end = 0;
  for (let i = 0; i < STAGES.length; i++) {
    end += STAGES[i].seconds;
    if (elapsed < end) return `s${i}`;
  }
  return `s${STAGES.length - 1}`;
}

export default function () {
  const from = 1 + Math.floor(Math.random() * WALLETS);
  let to = 1 + Math.floor(Math.random() * (WALLETS - 1));
  if (to >= from) to++; // ví nhận khác ví gửi
  const phase = phaseNow();
  const headers = { 'content-type': 'application/json' };
  if (CONN_CLOSE_EVERY > 0 && __ITER % CONN_CLOSE_EVERY === CONN_CLOSE_EVERY - 1) headers.connection = 'close';
  const res = http.post(
    `${BASE}/transfers`,
    JSON.stringify({ fromWalletId: from, toWalletId: to, amount: 1000, userId: `k6-${__VU}` }),
    { headers, tags: { name: 'POST /transfers', phase } },
  );
  if (res.status !== 200) {
    let kind = res.status === 0 ? 'network' : 'http_other';
    if (res.status === 503) {
      try {
        kind = res.json('error') || kind;
      } catch (_) {
        // body không phải JSON: giữ http_other
      }
    }
    errors.add(1, { phase, kind });
  }
  check(res, { 'chuyển tiền 200': (r) => r.status === 200 });
}

function phaseSummary(data, p) {
  const d = data.metrics[`http_req_duration{phase:${p},expected_response:true}`];
  const reqs = data.metrics[`http_reqs{phase:${p}}`];
  const failed = data.metrics[`http_req_failed{phase:${p}}`];
  const byKind = {};
  for (const k of KINDS) {
    const c = data.metrics[`transfer_errors{phase:${p},kind:${k}}`];
    if (c && c.values.count > 0) byKind[k] = c.values.count;
  }
  const v = d ? d.values : {};
  return {
    requests: reqs ? reqs.values.count : 0,
    failedRate: failed ? failed.values.rate : 0,
    errorsByKind: byKind,
    // độ trễ chỉ tính request thành công (200); request lỗi trả nhanh sẽ kéo các phân vị xuống
    okLatencyMs: { med: v.med, avg: v.avg, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max },
  };
}

export function handleSummary(data) {
  const phases = {};
  for (const p of PHASES) phases[p] = phaseSummary(data, p);
  // Tải mở: số lượt k6 bỏ vì hết người dùng ảo rảnh (hệ thống không theo kịp RATE).
  const dropped = data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values.count : 0;
  const out = { name: NAME, vus: VUS, rate: RATE, durationS: DURATION_S, warmupS: WARMUP_S, stages: STAGES, connCloseEvery: CONN_CLOSE_EVERY, wallets: WALLETS, droppedIterations: dropped, phases };
  const r = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const lines = [`== ${NAME}${RATE ? ` (RATE ${RATE}/s, bỏ ${dropped} lượt)` : ''}`];
  for (const p of PHASES) {
    const s = phases[p];
    lines.push(
      `${p}: ${s.requests} req · lỗi ${r(s.failedRate * 100)} % ${JSON.stringify(s.errorsByKind)} · ok med ${r(s.okLatencyMs.med)} ms · p95 ${r(s.okLatencyMs.p95)} ms · p99 ${r(s.okLatencyMs.p99)} ms`,
    );
  }
  return { stdout: lines.join('\n') + '\n', [`${RESULTS_DIR}/${NAME}.k6.json`]: JSON.stringify(out, null, 2) };
}
