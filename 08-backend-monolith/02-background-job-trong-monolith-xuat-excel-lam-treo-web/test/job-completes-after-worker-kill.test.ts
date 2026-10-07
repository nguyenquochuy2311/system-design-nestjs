import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createQueue, createTenant, dropQueue, getExport, jobRow, openDb, postExport, queueCounts, readXlsx, spawnWorker, startWeb,
  stopProcess, testConfig, waitFor, type WebApp,
} from './support/lab';

// 20.000 dòng, lô 1.000 dòng, mỗi lô chậm có chủ đích 150 ms: job mất khoảng 3 giây, đủ để kill giữa chừng.
const ROWS = 20_000;
const VT = 2; // visibility timeout ngắn để test không phải chờ 300 giây như cấu hình thật
const db = openDb();
let queue: string;
let web: WebApp;
let users: number[];
const children: Awaited<ReturnType<typeof spawnWorker>>[] = [];

const workerEnv = () => ({ EXPORT_QUEUE: queue, EXPORT_VT_SECONDS: String(VT), EXPORT_BATCH_DELAY_MS: '150', WORKER_POLL_MS: '100' });

beforeAll(async () => {
  queue = await createQueue(db);
  web = await startWeb(testConfig({ queue }));
  users = (await createTenant(db, ROWS, 2)).userIds;
});

afterEach(async () => {
  await Promise.all(children.splice(0).map((c) => stopProcess(c, 'SIGKILL')));
});

afterAll(async () => {
  await web.close();
  await dropQueue(db, queue);
  await db.destroy();
});

describe('worker chết giữa chừng (visibility timeout)', () => {
  it('SIGKILL worker giữa chừng: message hiện lại sau visibility timeout, worker khác làm xong, file đủ dòng', async () => {
    const userId = users[0]!;
    const a = await spawnWorker(workerEnv());
    children.push(a);
    const { body } = await postExport(web.baseUrl, userId);

    await waitFor('worker A ghi được 5.000 dòng', async () => (await jobRow(db, body.id)).rows_written >= 5_000);
    await stopProcess(a, 'SIGKILL'); // như `docker kill`: không kịp dọn dẹp gì

    const afterKill = await jobRow(db, body.id);
    expect(afterKill.status).toBe('running');
    expect(afterKill.rows_written).toBeLessThan(ROWS);
    expect(await queueCounts(db, queue)).toEqual({ total: 1, visible: 0 }); // message còn, đang bị ẩn

    const b = await spawnWorker(workerEnv());
    children.push(b);
    const done = await waitFor('job xong', async () => {
      const row = await jobRow(db, body.id);
      return row.status === 'done' ? row : undefined;
    });
    expect(done.attempts).toBe(2); // read_ct = 2: lần đọc của A và lần đọc của B
    expect(done.row_count).toBe(ROWS);
    expect(await queueCounts(db, queue)).toEqual({ total: 0, visible: 0 });

    const status = await getExport(web.baseUrl, userId, body.id);
    const file = await fetch(String(status.body.downloadUrl));
    expect(file.status).toBe(200);
    const rows = await readXlsx(await file.arrayBuffer());
    expect(rows).toHaveLength(ROWS + 1); // tiêu đề + đủ dòng, không thiếu phần A đã ghi dở
  });

  it('job dài hơn visibility timeout không bị worker thứ hai làm trùng nhờ heartbeat gia hạn', async () => {
    const userId = users[1]!;
    children.push(await spawnWorker(workerEnv()), await spawnWorker(workerEnv()));
    const { body } = await postExport(web.baseUrl, userId);
    const done = await waitFor('job xong', async () => {
      const row = await jobRow(db, body.id);
      return row.status === 'done' ? row : undefined;
    });
    expect(done.attempts).toBe(1); // chỉ một lần đọc: worker thứ hai không nhận lại message
    const logs = children.map((c) => c.output()).join('\n');
    expect(logs.match(new RegExp(`job ${body.id} \\(`, 'g')) ?? []).toHaveLength(1);
    const seconds = (done.finished_at!.getTime() - done.created_at.getTime()) / 1000;
    expect(seconds).toBeGreaterThan(VT); // job thật sự dài hơn visibility timeout
  });
});
