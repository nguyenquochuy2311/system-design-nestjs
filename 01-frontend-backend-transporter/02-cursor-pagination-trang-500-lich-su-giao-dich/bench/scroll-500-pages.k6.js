// 50 kế toán lật lịch sử giao dịch của 10 merchant lớn, mỗi người ở một chỗ khác nhau trong 500 trang đầu.
// Ví dụ: k6 run -e MODE=offset -e NAME=r1-A -e OUT=bench/results/trial/k6 bench/scroll-500-pages.k6.js
// Biến: MODE=offset|keyset · VUS (50) · WARMUP (10s) · DURATION (30s) · MERCHANTS (10) · PAGES (500) · NAME · OUT · BASE_URL
//
// Mỗi người dùng ảo (VU) giữ một merchant và một trang bắt đầu (trải đều 1..500), rồi lật tới trang sau liên tục, hết
// trang 500 thì quay lại trang 1. Bản offset gửi page=N; bản keyset gửi lại đúng nextCursor vừa nhận (lật trang thật).
// Trang bắt đầu của bản keyset cần cursor của trang đó: setup() lật trước 500 trang của mỗi merchant để lấy.
// Request trong WARMUP gắn phase=warmup và không tính; tag `name` cố định để k6 không tạo chuỗi số liệu theo từng URL.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const MODE = __ENV.MODE || 'keyset';
const VUS = Number(__ENV.VUS || 50);
const WARMUP_S = Number((__ENV.WARMUP || '10s').replace('s', ''));
const DURATION_S = Number((__ENV.DURATION || '30s').replace('s', ''));
const MERCHANTS = Number(__ENV.MERCHANTS || 10);
const PAGES = Number(__ENV.PAGES || 500);
const SIZE = 20;
const NAME = __ENV.NAME || MODE;
const OUT = __ENV.OUT || 'bench/results/trial/k6';
const ENDPOINT = MODE === 'offset' ? 'GET /merchants/:id/transactions?page' : 'GET /merchants/:id/transactions?cursor';
const DEPTHS = ['001-050', '051-250', '251-500'];

const thresholds = { 'http_req_duration{phase:main}': ['p(95)>=0'], 'http_reqs{phase:main}': ['count>=0'], 'checks{phase:main}': ['rate>=0'] };
for (const d of DEPTHS) thresholds[`http_req_duration{phase:main,depth:${d}}`] = ['p(95)>=0'];

export const options = {
  scenarios: {
    scroll: { executor: 'constant-vus', vus: VUS, duration: `${WARMUP_S + DURATION_S}s`, gracefulStop: '120s' },
  },
  setupTimeout: '300s',
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const merchantOf = (vu) => 1 + ((vu - 1) % MERCHANTS);
const startPageOf = (vu) => 1 + (((vu - 1) * 53) % PAGES);
const depthOf = (page) => (page <= 50 ? DEPTHS[0] : page <= 250 ? DEPTHS[1] : DEPTHS[2]);

export function setup() {
  if (MODE !== 'keyset') return { cursors: {} };
  // cursors[m][p] = cursor để lấy trang p của merchant m (trang 1 không cần cursor).
  const cursors = {};
  for (let m = 1; m <= MERCHANTS; m++) {
    const list = [null, null];
    let cursor = null;
    for (let p = 1; p < PAGES; p++) {
      const qs = cursor ? `limit=${SIZE}&cursor=${encodeURIComponent(cursor)}` : `limit=${SIZE}`;
      const res = http.get(`${BASE}/merchants/${m}/transactions?${qs}`, { tags: { name: ENDPOINT, phase: 'setup' } });
      if (res.status !== 200) throw new Error(`setup: merchant ${m} trang ${p} trả ${res.status}`);
      cursor = res.json('nextCursor');
      list.push(cursor);
    }
    cursors[m] = list;
  }
  return { cursors };
}

let state = null; // trạng thái riêng của từng VU: merchant, trang đang xem, cursor của trang đó

export default function (data) {
  if (!state) {
    const vu = exec.vu.idInTest;
    const merchant = merchantOf(vu);
    const page = startPageOf(vu);
    state = { merchant, page, cursor: MODE === 'keyset' ? data.cursors[merchant][page] : null };
  }
  const elapsed = exec.instance.currentTestRunDuration / 1000;
  const tags = { name: ENDPOINT, phase: elapsed < WARMUP_S ? 'warmup' : 'main', depth: depthOf(state.page) };
  const url =
    MODE === 'offset'
      ? `${BASE}/merchants/${state.merchant}/transactions?page=${state.page}&size=${SIZE}`
      : `${BASE}/merchants/${state.merchant}/transactions?limit=${SIZE}${state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : ''}`;
  const res = http.get(url, { tags, timeout: '120s' });
  let body = null;
  try {
    body = res.json();
  } catch (_) {
    body = null;
  }
  check(res, { '200 và đủ 20 dòng': () => res.status === 200 && body !== null && body.items.length === SIZE }, tags);

  if (state.page >= PAGES || body === null) {
    state.page = 1;
    state.cursor = null;
  } else {
    state.page += 1;
    state.cursor = MODE === 'keyset' ? body.nextCursor : null;
  }
}

function trend(data, key) {
  const m = data.metrics[key];
  if (!m) return null;
  const v = m.values;
  return { count: m.type === 'trend' ? undefined : v.count, avg: v.avg, min: v.min, med: v.med, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max };
}

export function handleSummary(data) {
  const out = {
    name: NAME,
    mode: MODE,
    endpoint: ENDPOINT,
    vus: VUS,
    warmupSeconds: WARMUP_S,
    durationSeconds: DURATION_S,
    requests: data.metrics['http_reqs{phase:main}']?.values.count ?? 0,
    checksRate: data.metrics['checks{phase:main}']?.values.rate ?? null,
    failedRate: data.metrics.http_req_failed?.values.rate ?? 0,
    duration: trend(data, 'http_req_duration{phase:main}'),
    byDepth: Object.fromEntries(DEPTHS.map((d) => [d, trend(data, `http_req_duration{phase:main,depth:${d}}`)])),
  };
  const r = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);
  const t = out.duration || {};
  const text = `== ${NAME} (${MODE}, ${VUS} VU, ${DURATION_S}s): ${out.requests} req · med ${r(t.med)} ms · p95 ${r(t.p95)} ms · p99 ${r(t.p99)} ms · max ${r(t.max)} ms · checks ${r((out.checksRate ?? 0) * 100)} %\n`;
  return { stdout: text, [`${OUT}/${NAME}.json`]: JSON.stringify(out, null, 2) };
}
