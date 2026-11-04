import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../../libs/platform/database';
import { logEvent } from '../../libs/platform/log';
import { translateCatalogEvent } from './acl/catalog-event-translator';

export const CATALOG_EVENT_POLL_MS = Symbol('CATALOG_EVENT_POLL_MS');

const VISIBILITY_SECONDS = 30;
const BATCH_SIZE = 20;

interface QueueMessage {
  msg_id: number;
  message: unknown;
}

@Injectable()
export class CatalogEventConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CATALOG_EVENT_POLL_MS) private readonly pollMs: number,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        // Message chưa archive sẽ hiện lại sau visibility timeout, nên lỗi tạm thời không làm mất sự kiện.
        logEvent({ service: 'ordering', event: 'catalog_event_poll_failed', error: String(error) });
      }
      await sleep(this.pollMs);
    }
  }

  private async pollOnce(): Promise<void> {
    const { rows } = await this.db.query<QueueMessage>(
      "SELECT msg_id, message FROM pgmq.read('catalog_events', $1::int, $2::int)",
      [VISIBILITY_SECONDS, BATCH_SIZE],
    );
    for (const message of rows) {
      await this.handle(message);
    }
  }

  private handle(message: QueueMessage): Promise<void> {
    const translation = translateCatalogEvent(message.message);
    return this.db.transaction(async (tx) => {
      if (translation.kind === 'apply') {
        const { sku, productName, unitPriceVnd, priceVersion } = translation.update;
        // [PATTERN] Hàng đợi giao ít nhất một lần và có thể đảo thứ tự: chỉ bản mới hơn được ghi đè, nên sự kiện trùng
        // hoặc tới muộn không kéo giá về bản cũ.
        await tx.query(
          `INSERT INTO ordering.product_snapshots AS snapshot (sku, product_name, unit_price_vnd, price_version)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sku) DO UPDATE
             SET product_name = EXCLUDED.product_name, unit_price_vnd = EXCLUDED.unit_price_vnd,
                 price_version = EXCLUDED.price_version
             WHERE EXCLUDED.price_version > snapshot.price_version`,
          [sku, productName, unitPriceVnd, priceVersion],
        );
      }
      if (translation.kind === 'quarantine') {
        await tx.query(
          `INSERT INTO ordering.quarantined_events (msg_id, reason, payload) VALUES ($1, $2, $3)
           ON CONFLICT (msg_id) DO NOTHING`,
          [message.msg_id, translation.reason, JSON.stringify(message.message)],
        );
        logEvent({ service: 'ordering', event: 'catalog_event_quarantined', msgId: message.msg_id });
      }
      await tx.query("SELECT pgmq.archive('catalog_events', $1::bigint)", [message.msg_id]);
    });
  }
}
