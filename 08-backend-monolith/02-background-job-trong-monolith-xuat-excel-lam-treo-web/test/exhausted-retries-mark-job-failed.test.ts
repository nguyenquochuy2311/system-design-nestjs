import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectStorage } from '../src/shared/object-storage';
import {
  archivedMessages, createQueue, createTenant, dropQueue, getExport, jobRow, openDb, postExport, queueCounts, startWeb,
  startWorkerInProcess, testConfig, waitFor, type WebApp,
} from './support/lab';

/** Object storage luôn lỗi, như bucket bị xóa hoặc sai quyền: job không bao giờ xong. */
class BrokenStorage implements ObjectStorage {
  calls = 0;
  async uploadStream(_key: string, body: Readable): Promise<void> {
    this.calls++;
    body.resume();
    throw new Error('AccessDenied (giả lập)');
  }
  async presignDownload(): Promise<string> {
    throw new Error('không dùng tới');
  }
}

const db = openDb();
let queue: string;
let web: WebApp;
let users: number[];

beforeAll(async () => {
  queue = await createQueue(db);
  web = await startWeb(testConfig({ queue }));
  users = (await createTenant(db, 3_000, 1)).userIds;
});

afterAll(async () => {
  await web.close();
  await dropQueue(db, queue);
  await db.destroy();
});

describe('giới hạn số lần thử', () => {
  it('lỗi quá 3 lần thì job failed, message được archive và không còn trong hàng đợi', async () => {
    const storage = new BrokenStorage();
    // visibility timeout 1 giây để ba lần thử diễn ra trong vài giây
    const worker = await startWorkerInProcess(testConfig({ queue, visibilityTimeoutSeconds: 1, maxAttempts: 3 }), storage);
    worker.worker.start();
    try {
      const { body } = await postExport(web.baseUrl, users[0]!);
      const failed = await waitFor('job failed', async () => {
        const row = await jobRow(db, body.id);
        return row.status === 'failed' ? row : undefined;
      });

      expect(storage.calls).toBe(3); // đúng 3 lần thử, lần đọc thứ 4 chỉ để archive
      expect(failed.attempts).toBe(3);
      expect(failed.last_error).toContain('hết 3 lượt thử');
      expect(failed.last_error).toContain('AccessDenied (giả lập)');
      expect(await queueCounts(db, queue)).toEqual({ total: 0, visible: 0 });
      const archived = await archivedMessages(db, queue);
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({ read_ct: 4, message: { jobId: body.id } });

      const status = await getExport(web.baseUrl, users[0]!, body.id);
      expect(status.body).toMatchObject({ status: 'failed' });
      expect(status.body.downloadUrl).toBeUndefined();
    } finally {
      await worker.close();
    }
  });
});
