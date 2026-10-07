import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_CONFIG, type AppConfig } from '../../shared/config';
import { KYSELY, type Database } from '../../shared/db';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/object-storage';
import { reportQuery } from '../../shared/order-report';
import { archiveMessage, deleteMessage, extendVisibility, readMessages, type QueueMessage } from './export-queue';
import { writeOrdersXlsx } from './xlsx-stream.writer';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Kết quả xử lý một message, để test và log biết worker đã làm gì. */
export type HandleOutcome = 'done' | 'failed' | 'retry' | 'skipped';

/**
 * Worker của process type `worker`: lấy job từ PGMQ, đọc dữ liệu theo cursor, ghi Excel theo luồng lên object storage.
 * Chạy trong tiến trình riêng (src/main.worker.ts) nên CPU và bộ nhớ của việc xuất file không chạm tới web process.
 */
@Injectable()
export class ExportWorker {
  private readonly log = new Logger('ExportWorker');
  private stopping = false;
  private loops: Promise<void>[] = [];

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Mỗi vòng lặp xử lý một job tại một thời điểm: `concurrency` vòng = giới hạn số job đồng thời của worker. */
  start(): void {
    const { concurrency } = this.config.worker;
    this.loops = Array.from({ length: concurrency }, (_, i) => this.loop(i));
  }

  /** Dừng nhận job mới, chờ job đang chạy xong (graceful shutdown khi nhận SIGTERM). */
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.loops);
  }

  private async loop(slot: number): Promise<void> {
    const { queue, visibilityTimeoutSeconds } = this.config.exports;
    while (!this.stopping) {
      let messages: QueueMessage[];
      try {
        // [PATTERN] đọc với visibility timeout: message bị ẩn chứ không bị xóa; worker chết thì nó hiện lại
        messages = await readMessages(this.db, queue, visibilityTimeoutSeconds, 1);
      } catch (err) {
        this.log.error(`slot ${slot}: đọc hàng đợi lỗi: ${(err as Error).message}`);
        await sleep(this.config.worker.pollMs);
        continue;
      }
      const msg = messages[0];
      if (!msg) {
        await sleep(this.config.worker.pollMs);
        continue;
      }
      const outcome = await this.handle(msg);
      this.log.log(`slot ${slot}: job ${msg.message.jobId} (msg ${msg.msg_id}, lần đọc ${msg.read_ct}) → ${outcome}`);
    }
  }

  async handle(msg: QueueMessage): Promise<HandleOutcome> {
    const { queue, maxAttempts, visibilityTimeoutSeconds: vt, batchSize, batchDelayMs } = this.config.exports;
    const jobId = msg.message.jobId;

    // [PATTERN] giới hạn số lần thử: read_ct vượt ngưỡng thì archive message và đánh dấu failed, không thử vô hạn
    if (msg.read_ct > maxAttempts) {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('export_jobs')
          .set({
            status: 'failed',
            finished_at: new Date(),
            last_error: sql<string>`${`hết ${maxAttempts} lượt thử; lỗi cuối: `} || coalesce(last_error, 'worker dừng giữa chừng')`,
          })
          .where('id', '=', jobId)
          .where('status', 'in', ['queued', 'running'])
          .execute();
        await archiveMessage(trx, queue, msg.msg_id);
      });
      return 'failed';
    }

    const job = await this.db
      .updateTable('export_jobs')
      .set({ status: 'running', attempts: msg.read_ct, rows_written: 0, started_at: new Date() })
      .where('id', '=', jobId)
      .where('status', 'in', ['queued', 'running'])
      .returning(['id', 'tenant_id', 'filter'])
      .executeTakeFirst();
    if (!job) {
      // job đã done/failed (message giao lại sau khi đã xong): xóa message, không làm lại
      await deleteMessage(this.db, queue, msg.msg_id);
      return 'skipped';
    }

    // Heartbeat: còn sống thì gia hạn visibility timeout, để job dài không bị worker khác nhận làm trùng
    const heartbeat = setInterval(() => {
      extendVisibility(this.db, queue, msg.msg_id, vt).catch((err) => this.log.warn(`gia hạn msg ${msg.msg_id} lỗi: ${err.message}`));
    }, Math.max(500, (vt * 1000) / 3));
    try {
      const objectKey = `exports/${job.id}.xlsx`; // cùng khóa mỗi lần chạy lại: ghi đè, không sinh file rác
      const body = new PassThrough();
      body.on('error', () => {}); // lỗi của luồng đã được xử lý qua hai promise bên dưới; tránh 'error' không ai nghe làm sập tiến trình
      const uploading = this.storage.uploadStream(objectKey, body, XLSX).catch((err: Error) => {
        body.destroy(err);
        throw err;
      });
      const rows = reportQuery(this.db, job.tenant_id, job.filter.month).stream(batchSize);
      const writing = writeOrdersXlsx(rows, body, batchSize, async (n) => {
        await this.db.updateTable('export_jobs').set({ rows_written: n }).where('id', '=', job.id).execute();
        if (batchDelayMs > 0) await sleep(batchDelayMs);
      }).catch((err: Error) => {
        body.destroy(err);
        throw err;
      });
      const [rowCount] = await Promise.all([writing, uploading]);

      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('export_jobs')
          .set({ status: 'done', row_count: rowCount, rows_written: rowCount, object_key: objectKey, finished_at: new Date(), last_error: null })
          .where('id', '=', job.id)
          .execute();
        await deleteMessage(trx, queue, msg.msg_id); // xong việc mới xóa message, cùng transaction với trạng thái done
      });
      return 'done';
    } catch (err) {
      const message = (err as Error).message;
      this.log.warn(`job ${jobId} lần ${msg.read_ct} lỗi: ${message}`);
      await this.db.updateTable('export_jobs').set({ status: 'queued', last_error: message }).where('id', '=', jobId).execute();
      // Không xóa message: cho hiện lại sau một khoảng chờ tăng dần (không quá visibility timeout)
      await extendVisibility(this.db, queue, msg.msg_id, Math.min(vt, 2 ** msg.read_ct));
      return 'retry';
    } finally {
      clearInterval(heartbeat);
    }
  }
}
