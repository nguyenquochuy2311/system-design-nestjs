import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { throttledWarn } from '../shared/page.cache';
import { cacheKeys } from '../shared/pages';

export interface WorkerOptions {
  /** Số sự kiện tối đa mỗi lô (mỗi transaction). */
  batchSize: number;
  /** Chu kỳ đọc outbox khi không có việc (README mục 3.2: 500 ms). */
  pollMs: number;
  /** Số key mỗi lệnh UNLINK. */
  unlinkChunk: number;
}

export interface BatchResult {
  events: number;
  products: number;
  keysTargeted: number;
  keysRemoved: number;
  ms: number;
}

const EMPTY: BatchResult = { events: 0, products: 0, keysTargeted: 0, keysRemoved: 0, ms: 0 };

/**
 * Worker invalidation: đọc sự kiện "giá đã đổi" từ outbox, xóa mọi key trang chứa sản phẩm, rồi đánh dấu đã xử lý.
 * Toàn bộ một lô nằm trong một transaction PostgreSQL: Redis lỗi thì ném lỗi, rollback, sự kiện nằm lại và được làm lại
 * ở lượt sau. Xóa key là idempotent nên làm lại không hại; TTL giới hạn độ cũ nếu Redis hỏng lâu.
 */
export class InvalidationWorker {
  private readonly logger = new Logger('invalidation');
  private readonly warn = throttledWarn(this.logger);
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  readonly stats = { batches: 0, events: 0, keysTargeted: 0, keysRemoved: 0, failures: 0 };

  constructor(
    private readonly db: Kysely<Database>,
    private readonly redis: Redis,
    private readonly opts: WorkerOptions = { batchSize: 500, pollMs: 500, unlinkChunk: 500 },
    private readonly logBatches = false,
  ) {}

  async runOnce(): Promise<BatchResult> {
    // Kiểm rẻ ngoài transaction: lúc rảnh mỗi chu kỳ chỉ một câu SELECT thay vì BEGIN / SELECT FOR UPDATE / COMMIT.
    const pending = await this.db.selectFrom('price_outbox').select('id').where('processed_at', 'is', null).limit(1).executeTakeFirst();
    if (!pending) return EMPTY;
    const started = performance.now();
    return this.db.transaction().execute(async (trx) => {
      // [PATTERN] chỉ đọc sự kiện đã commit → xóa cache luôn sau lần ghi DB; SKIP LOCKED để nhiều worker chia việc
      const rows = await trx
        .selectFrom('price_outbox')
        .select(['id', 'product_id'])
        .where('processed_at', 'is', null)
        .orderBy('id')
        .limit(this.opts.batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      if (!rows.length) return EMPTY;
      const productIds = [...new Set(rows.map((r) => r.product_id))];

      // [PATTERN] chỉ mục ngược: tag:product:<id> liệt kê key trang có chứa sản phẩm; key chi tiết tính thẳng từ id
      const members = (await this.exec(productIds.map((id) => ['smembers', cacheKeys.tag('sau', id)]))) as string[][];
      const keys = new Set<string>();
      const perProduct = new Map<number, number>();
      productIds.forEach((id, i) => {
        const own = new Set([cacheKeys.product('sau', id), ...members[i]!]);
        own.forEach((k) => keys.add(k));
        perProduct.set(id, own.size);
      });

      // [PATTERN] UNLINK theo lô: Redis giải phóng bộ nhớ ở luồng nền, một sự kiện xóa nghìn key không chặn client khác
      let keysRemoved = 0;
      const all = [...keys];
      for (let i = 0; i < all.length; i += this.opts.unlinkChunk) keysRemoved += await this.redis.unlink(...all.slice(i, i + this.opts.unlinkChunk));
      // Gỡ đúng các member vừa đọc, không xóa cả tag: trang nạp chen giữa (đã mang giá mới) vẫn còn trong chỉ mục.
      await this.exec(productIds.flatMap((id, i) => (members[i]!.length ? [['srem', cacheKeys.tag('sau', id), ...members[i]!]] : [])));

      await sql`
        UPDATE price_outbox o SET processed_at = clock_timestamp(), keys_targeted = v.n
        FROM unnest(${rows.map((r) => r.id)}::bigint[], ${rows.map((r) => perProduct.get(r.product_id)!)}::int[]) AS v(id, n)
        WHERE o.id = v.id`.execute(trx);
      return { events: rows.length, products: productIds.length, keysTargeted: all.length, keysRemoved, ms: Math.round(performance.now() - started) };
    });
  }

  /** Chạy runOnce mỗi pollMs; lô đầy thì chạy tiếp ngay để xả tồn đọng. */
  start(): void {
    if (this.loop) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let full = false;
        try {
          const r = await this.runOnce();
          if (r.events) {
            this.stats.batches++;
            this.stats.events += r.events;
            this.stats.keysTargeted += r.keysTargeted;
            this.stats.keysRemoved += r.keysRemoved;
            if (this.logBatches) this.logger.log(`lô ${r.events} sự kiện, ${r.products} sản phẩm, xóa ${r.keysRemoved}/${r.keysTargeted} key, ${r.ms} ms`);
          }
          full = r.events >= this.opts.batchSize;
        } catch (err) {
          this.stats.failures++;
          this.warn(`xử lý outbox lỗi: ${(err as Error).message}; sự kiện giữ nguyên trong outbox, thử lại sau ${this.opts.pollMs} ms`);
        }
        if (!full && this.running) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.opts.pollMs);
            this.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    this.loop = null;
  }

  /** Pipeline nhiều lệnh; lệnh nào lỗi thì ném lỗi để cả lô rollback. */
  private async exec(commands: (string | number)[][]): Promise<unknown[]> {
    if (!commands.length) return [];
    const results = (await this.redis.pipeline(commands).exec()) ?? [];
    for (const [err] of results) if (err) throw err;
    return results.map(([, value]) => value);
  }
}
