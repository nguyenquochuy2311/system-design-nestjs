import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { logEvent } from './log';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export async function sendMessage(client: Queryable, queue: string, message: unknown, delaySeconds = 0): Promise<void> {
  await client.query('SELECT pgmq.send($1, $2::jsonb, $3::int)', [queue, JSON.stringify(message), delaySeconds]);
}

export async function archiveMessage(client: Queryable, queue: string, msgId: number): Promise<void> {
  await client.query('SELECT pgmq.archive($1, $2::bigint)', [queue, msgId]);
}

export interface ConsumerSettings {
  service: string;
  queue: string;
  visibilitySeconds: number;
  batchSize: number;
  pollMs: number;
}

/**
 * Đọc hàng đợi và gọi handler song song theo lô. Handler tự archive trong transaction của nó, nên message chỉ biến mất khi
 * việc đã commit. Lỗi hay crash giữa chừng thì message hiện lại sau visibility timeout, không cần ai nhớ phải làm lại.
 */
export class QueueConsumer<Message> {
  private running = false;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly db: pg.Pool,
    private readonly settings: ConsumerSettings,
    private readonly handle: (msgId: number, message: Message) => Promise<void>,
  ) {}

  start(): void {
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    const { service, queue, visibilitySeconds, batchSize, pollMs } = this.settings;
    while (this.running) {
      try {
        const { rows } = await this.db.query<{ msg_id: string; message: Message }>(
          'SELECT msg_id, message FROM pgmq.read($1, $2::int, $3::int)',
          [queue, visibilitySeconds, batchSize],
        );
        await Promise.all(
          rows.map((row) =>
            this.handle(Number(row.msg_id), row.message).catch((error: unknown) => {
              logEvent({ service, event: 'message_failed', queue, msgId: row.msg_id, error: String(error) });
            }),
          ),
        );
        if (rows.length === batchSize) {
          continue;
        }
      } catch (error) {
        logEvent({ service, event: 'queue_poll_failed', queue, error: String(error) });
      }
      await sleep(pollMs);
    }
  }
}
