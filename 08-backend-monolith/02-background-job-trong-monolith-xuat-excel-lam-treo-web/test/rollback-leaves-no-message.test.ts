import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateExportService } from '../src/sau/exports/create-export.service';
import { readMessages, sendMessage } from '../src/sau/exports/export-queue';
import { createQueue, createTenant, dropQueue, MONTH, openDb, queueCounts, testConfig } from './support/lab';

const db = openDb();
const other = openDb(); // kết nối thứ hai, đóng vai worker đọc hàng đợi
let queue: string;
let users: number[];

beforeAll(async () => {
  queue = await createQueue(db);
  users = (await createTenant(db, 10, 2)).userIds;
  // Giả lập "commit thất bại sau khi đã pgmq.send": constraint trigger hoãn tới lúc COMMIT, chỉ áp cho users[1].
  // Không sửa code ứng dụng: service chạy y như thật, chỉ COMMIT của nó bị database từ chối.
  await sql.raw(`
    CREATE OR REPLACE FUNCTION test_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'commit bị từ chối (giả lập)'; END $$;
    DROP TRIGGER IF EXISTS test_fail_commit ON export_jobs;
    CREATE CONSTRAINT TRIGGER test_fail_commit AFTER INSERT ON export_jobs DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.requested_by = ${users[1]}) EXECUTE FUNCTION test_fail_commit();
  `).execute(db);
});

afterAll(async () => {
  await sql.raw(`DROP TRIGGER IF EXISTS test_fail_commit ON export_jobs; DROP FUNCTION IF EXISTS test_fail_commit();`).execute(db);
  await dropQueue(db, queue);
  await db.destroy();
  await other.destroy();
});

describe('ghi job và gửi message trong cùng một transaction', () => {
  it('message chưa commit thì worker không thấy; commit xong mới đọc được', async () => {
    let seenBeforeCommit = -1;
    await db.transaction().execute(async (trx) => {
      await sendMessage(trx, queue, { jobId: -1 });
      seenBeforeCommit = (await readMessages(other, queue, 30, 10)).length;
    });
    expect(seenBeforeCommit).toBe(0);
    const after = await readMessages(other, queue, 30, 10);
    expect(after.map((m) => m.message.jobId)).toEqual([-1]);
    await sql`SELECT pgmq.purge_queue(${queue})`.execute(db);
  });

  it('transaction rollback sau pgmq.send thì không còn message nào', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await sendMessage(trx, queue, { jobId: -2 });
        throw new Error('lỗi giữa chừng');
      }),
    ).rejects.toThrow('lỗi giữa chừng');
    expect(await queueCounts(db, queue)).toEqual({ total: 0, visible: 0 });
  });

  it('CreateExportService: COMMIT thất bại thì không có job và không có message mồ côi', async () => {
    const service = new CreateExportService(db, testConfig({ queue }));
    await expect(service.request(users[1]!, { month: MONTH })).rejects.toThrow('commit bị từ chối');

    const jobs = await db.selectFrom('export_jobs').select('id').where('requested_by', '=', users[1]!).execute();
    expect(jobs).toHaveLength(0);
    expect(await queueCounts(db, queue)).toEqual({ total: 0, visible: 0 });

    // đối chứng: người dùng không bị trigger chặn thì có đúng một job và một message
    const ok = await service.request(users[0]!, { month: MONTH });
    expect(ok.created).toBe(true);
    expect((await queueCounts(db, queue)).total).toBe(1);
  });
});
