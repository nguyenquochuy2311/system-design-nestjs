import pg from 'pg';
import { archiveMessage, QueueConsumer } from '../shared/queue';

export const EXPORT_CONCURRENCY = 2;

export interface ExportWorker {
  stop(): Promise<void>;
}

/** Xử lý xuất dữ liệu với concurrency cố định: lô đọc từ hàng đợi bằng đúng số việc được chạy cùng lúc. */
export function startExportWorker(connectionString: string, reportSeconds: number, pollMs: number): ExportWorker {
  const pool = new pg.Pool({ connectionString, max: EXPORT_CONCURRENCY });
  const consumer = new QueueConsumer<{ exportId: string }>(
    pool,
    {
      service: 'export-worker',
      queue: 'exports',
      visibilitySeconds: Math.ceil(reportSeconds) + 10,
      batchSize: EXPORT_CONCURRENCY,
      pollMs,
    },
    async (msgId, { exportId }) => {
      await pool.query('SELECT pg_sleep($1)', [reportSeconds]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("UPDATE crm.exports SET status = 'DONE' WHERE id = $1", [exportId]);
        await archiveMessage(client, 'exports', msgId);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
  consumer.start();
  return {
    stop: async () => {
      await consumer.stop();
      await pool.end();
    },
  };
}
