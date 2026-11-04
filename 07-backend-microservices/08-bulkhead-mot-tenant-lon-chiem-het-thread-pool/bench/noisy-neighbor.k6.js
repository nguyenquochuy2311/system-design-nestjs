// Hai kịch bản song song: 50 khách nhỏ ghi chú ở tốc độ cố định, khách lớn T-1 chạy báo cáo.
// MODE=sustained: khách lớn giữ 30 báo cáo liên tục. MODE=batch: khách lớn cần xong đúng BATCH báo cáo, retry theo Retry-After.
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { sleep } from 'k6';

const BASE_URL = 'http://crm-api:3000';
const RATE = Number(__ENV.RATE ?? 50);
const DURATION = __ENV.DURATION ?? '3m';
const MODE = __ENV.MODE ?? 'sustained';
const BATCH = Number(__ENV.BATCH ?? 30);

const notesDuration = new Trend('notes_duration', true);
const notesWait = new Trend('notes_wait_ms');
const notesOk = new Counter('notes_ok');
const notesFailed = new Counter('notes_failed');
const reportsDone = new Counter('reports_done');
const reportsRejected = new Counter('reports_rejected');
const reportsFailed = new Counter('reports_failed');
const reportDuration = new Trend('report_duration', true);
const exportDuration = new Trend('export_duration', true);

const bigTenant = MODE === 'sustained'
  ? { executor: 'constant-vus', exec: 'reportLoop', vus: 30, duration: DURATION }
  : { executor: 'per-vu-iterations', exec: 'reportUntilDone', vus: BATCH, iterations: 1, maxDuration: '6m' };

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    small_tenants: {
      executor: 'constant-arrival-rate',
      exec: 'addNote',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      // Bản "trước" giữ ghi chú vài giây: đủ chỗ cho số request dồn lại (nhật ký 08/02 điểm 3).
      preAllocatedVUs: 800,
      maxVUs: 2000,
    },
    big_tenant: bigTenant,
    exports: {
      executor: 'constant-arrival-rate',
      exec: 'requestExport',
      rate: 12,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
};

const headers = (tenantId) => ({ 'content-type': 'application/json', 'x-tenant-id': tenantId });

export function addNote() {
  const tenantId = `T-${(exec.scenario.iterationInTest % 50) + 2}`;
  const response = http.post(`${BASE_URL}/notes`, JSON.stringify({ body: 'Ghi chú' }), {
    headers: headers(tenantId),
    tags: { name: 'POST /notes' },
    timeout: '30s',
  });
  notesDuration.add(response.timings.duration);
  (response.status === 201 ? notesOk : notesFailed).add(1);
  const wait = response.headers['X-Bulkhead-Wait-Ms'];
  if (wait !== undefined) {
    notesWait.add(Number(wait));
  }
}

function callReport() {
  const response = http.get(`${BASE_URL}/reports/pipeline`, {
    headers: headers('T-1'),
    tags: { name: 'GET /reports/pipeline' },
    timeout: '60s',
    responseCallback: http.expectedStatuses(200, 429),
  });
  if (response.status === 200) {
    reportsDone.add(1);
    reportDuration.add(response.timings.duration);
    return true;
  }
  if (response.status === 429) {
    reportsRejected.add(1);
    sleep(Number(response.headers['Retry-After'] ?? 1));
  } else {
    reportsFailed.add(1);
  }
  return false;
}

export function reportLoop() {
  callReport();
}

export function reportUntilDone() {
  while (!callReport()) {
    // Tôn trọng Retry-After rồi thử lại, tới khi báo cáo xong.
  }
}

export function requestExport() {
  const response = http.post(`${BASE_URL}/exports`, null, {
    headers: headers('T-1'),
    tags: { name: 'POST /exports' },
    timeout: '60s',
    responseCallback: http.expectedStatuses(200, 202, 429),
  });
  exportDuration.add(response.timings.duration);
}
