import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueue, createTenant, dropQueue, getExport, openDb, postExport, queueCounts, startWeb, testConfig, type WebApp } from './support/lab';

const db = openDb();
let queue: string;
let web: WebApp;
let users: number[];

beforeAll(async () => {
  queue = await createQueue(db);
  web = await startWeb(testConfig({ queue }));
  users = (await createTenant(db, 10, 3)).userIds;
});

afterAll(async () => {
  await web.close();
  await dropQueue(db, queue);
  await db.destroy();
});

const jobsOf = (userId: number) => db.selectFrom('export_jobs').select(['id', 'status']).where('requested_by', '=', userId).execute();

describe('POST /exports (Asynchronous Request-Reply)', () => {
  it('trả 202 Accepted kèm Location, GET trạng thái trả Retry-After khi job chưa xong', async () => {
    const userId = users[2]!;
    const res = await postExport(web.baseUrl, userId);
    expect(res.status).toBe(202);
    expect(res.location).toBe(`/exports/${res.body.id}`);
    expect(res.body).toMatchObject({ status: 'queued', created: true });

    const status = await getExport(web.baseUrl, userId, res.body.id);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('queued');
    expect(status.retryAfter).toBe('2');
    // người khác không xem được job của mình
    expect((await getExport(web.baseUrl, users[0]!, res.body.id)).status).toBe(404);
  });

  it('bấm "Xuất" 5 lần cùng lúc với cùng bộ lọc chỉ tạo một job và một message', async () => {
    const userId = users[0]!;
    const before = (await queueCounts(db, queue)).total;
    const responses = await Promise.all(Array.from({ length: 5 }, () => postExport(web.baseUrl, userId)));

    expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(responses.filter((r) => r.body.created)).toHaveLength(1);
    expect(await jobsOf(userId)).toHaveLength(1);
    expect((await queueCounts(db, queue)).total - before).toBe(1);
  });

  it('job cũ đã xong thì bấm lại tạo job mới; người khác cùng bộ lọc là job khác', async () => {
    const userId = users[0]!;
    const [first] = await jobsOf(userId);
    await db.updateTable('export_jobs').set({ status: 'done' }).where('id', '=', first!.id).execute();

    const again = await postExport(web.baseUrl, userId);
    expect(again.body.created).toBe(true);
    expect(again.body.id).not.toBe(first!.id);

    const other = await postExport(web.baseUrl, users[1]!);
    expect(other.body.created).toBe(true);
    expect(other.body.id).not.toBe(again.body.id);
  });

  it('bộ lọc sai trả 400, người dùng không tồn tại trả 404, không tạo job', async () => {
    const before = (await queueCounts(db, queue)).total;
    expect((await postExport(web.baseUrl, users[0]!, '2026-13')).status).toBe(400);
    expect((await postExport(web.baseUrl, 987654321)).status).toBe(404);
    expect((await queueCounts(db, queue)).total).toBe(before);
  });
});
