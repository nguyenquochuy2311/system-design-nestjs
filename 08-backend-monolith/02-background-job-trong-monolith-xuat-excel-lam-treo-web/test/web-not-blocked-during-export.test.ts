import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createQueue, createTenant, dropQueue, jobRow, MONTH, openDb, postExport, spawnWeb, spawnWorker, stopProcess, waitFor,
} from './support/lab';

// Cặp "trước tái hiện lỗi / sau hết lỗi": health check (như của load balancer) có còn trả lời nhanh trong lúc xuất 50.000 dòng không.
// Web chạy ở tiến trình riêng: nếu web nằm chung tiến trình với test thì client đo cũng bị chặn theo và bỏ lỡ lúc treo.
const ROWS = 50_000;
const db = openDb();
let queue: string;
let web: Awaited<ReturnType<typeof spawnWeb>>;
let users: number[];

beforeAll(async () => {
  queue = await createQueue(db);
  web = await spawnWeb({ EXPORT_QUEUE: queue });
  users = (await createTenant(db, ROWS, 2)).userIds;
});

afterAll(async () => {
  await stopProcess(web);
  await dropQueue(db, queue);
  await db.destroy();
});

/** Gọi GET /health liên tục tới khi `until` xong; trả độ trễ lớn nhất (ms) và số lần gọi. */
async function probeHealthUntil(until: Promise<unknown>): Promise<{ maxMs: number; probes: number }> {
  let finished = false;
  void until.finally(() => (finished = true));
  let maxMs = 0;
  let probes = 0;
  while (!finished) {
    const t0 = performance.now();
    const res = await fetch(`${web.baseUrl}/health`);
    await res.text();
    maxMs = Math.max(maxMs, performance.now() - t0);
    probes++;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { maxMs, probes };
}

describe('web process có bị treo khi đang xuất Excel 50.000 dòng không', () => {
  it('trước: xuất trong request làm health check chờ hơn 500 ms (event loop bị chặn)', async () => {
    const exporting = fetch(`${web.baseUrl}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(users[0]) } }).then(async (r) => {
      expect(r.status).toBe(200);
      return (await r.arrayBuffer()).byteLength;
    });
    const { maxMs, probes } = await probeHealthUntil(exporting);
    expect(await exporting).toBeGreaterThan(1_000_000);
    expect(probes).toBeGreaterThan(0);
    expect(maxMs).toBeGreaterThan(500);
  });

  it('sau: POST /exports trả 202 ngay, worker riêng xuất file, health check luôn dưới 200 ms', async () => {
    const worker = await spawnWorker({ EXPORT_QUEUE: queue, WORKER_POLL_MS: '100' });
    try {
      const t0 = performance.now();
      const { status, body } = await postExport(web.baseUrl, users[1]!);
      const acceptMs = performance.now() - t0;
      expect(status).toBe(202);
      expect(acceptMs).toBeLessThan(200);

      const done = waitFor('job xong', async () => (await jobRow(db, body.id)).status === 'done', 60_000, 50);
      const { maxMs, probes } = await probeHealthUntil(done);
      await done;
      expect(probes).toBeGreaterThan(5);
      expect(maxMs).toBeLessThan(200);
      expect((await jobRow(db, body.id)).row_count).toBe(ROWS);
    } finally {
      await stopProcess(worker);
    }
  });
});
