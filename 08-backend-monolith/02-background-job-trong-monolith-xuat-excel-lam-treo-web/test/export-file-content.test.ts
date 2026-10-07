import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMessages } from '../src/sau/exports/export-queue';
import {
  createQueue, createTenant, dropQueue, getExport, MONTH, openDb, postExport, readXlsx, startWeb, startWorkerInProcess, testConfig,
  type WebApp,
} from './support/lab';

const ROWS = 5_000;
const db = openDb();
let queue: string;
let web: WebApp;
let users: number[];

beforeAll(async () => {
  queue = await createQueue(db);
  web = await startWeb(testConfig({ queue, downloadTtlSeconds: 2 }));
  users = (await createTenant(db, ROWS, 1)).userIds;
});

afterAll(async () => {
  await web.close();
  await dropQueue(db, queue);
  await db.destroy();
});

describe('file kết quả', () => {
  it('file ghi theo luồng có cùng nội dung với file dựng trong bộ nhớ; URL tải hết hạn thì bị từ chối', async () => {
    const userId = users[0]!;
    const { body } = await postExport(web.baseUrl, userId);
    const worker = await startWorkerInProcess(testConfig({ queue }));
    try {
      const [msg] = await readMessages(db, queue, 30, 1);
      expect(await worker.worker.handle(msg!)).toBe('done');
    } finally {
      await worker.close();
    }

    const status = await getExport(web.baseUrl, userId, body.id);
    expect(status.body).toMatchObject({ status: 'done', rowCount: ROWS, expiresInSeconds: 2 });
    const streamed = await fetch(String(status.body.downloadUrl));
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('content-disposition')).toContain(`don-hang-${MONTH}.xlsx`);
    const streamedRows = await readXlsx(await streamed.arrayBuffer());

    const inMemory = await fetch(`${web.baseUrl}/truoc/reports/orders.xlsx?month=${MONTH}`, { headers: { 'x-user-id': String(userId) } });
    const inMemoryRows = await readXlsx(await inMemory.arrayBuffer());
    expect(streamedRows).toHaveLength(ROWS + 1);
    expect(streamedRows).toEqual(inMemoryRows);
    expect(streamedRows[0]).toEqual(['Mã đơn', 'Ngày tạo', 'Cửa hàng', 'Khách hàng', 'Điện thoại', 'Trạng thái', 'Số món', 'Tạm tính', 'Giảm giá', 'Tổng tiền']);

    await sleep(3_000); // quá TTL 2 giây của URL tải
    expect((await fetch(String(status.body.downloadUrl))).status).toBe(403);
    // hỏi lại trạng thái thì nhận URL mới còn hạn
    const fresh = await getExport(web.baseUrl, userId, body.id);
    expect((await fetch(String(fresh.body.downloadUrl))).status).toBe(200);
  });
});
