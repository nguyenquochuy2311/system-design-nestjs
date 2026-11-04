import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { Database } from '../../libs/platform/database';
import { logEvent } from '../../libs/platform/log';
import { splitAddress, translateOrderEvent, type ShipmentOrderUpdate } from './order-event-translator';
import { SHIPPING_CONFIG, type ShippingConfig, type ShippingTables } from './shipping-config';

const VISIBILITY_SECONDS = 5;
const BATCH_SIZE = 50;

interface QueueMessage {
  msg_id: number;
  message: unknown;
}

@Injectable()
export class OrderEventConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(Database) private readonly database: Database<ShippingTables>,
    @Inject(SHIPPING_CONFIG) private readonly config: ShippingConfig,
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
        logEvent({ service: 'shipping-service', event: 'order_event_poll_failed', error: String(error) });
      }
      await sleep(this.config.pollMs);
    }
  }

  private async pollOnce(): Promise<void> {
    const { rows } = await sql<QueueMessage>`
      SELECT msg_id, message FROM pgmq.read('order_events', ${VISIBILITY_SECONDS}::int, ${BATCH_SIZE}::int)`.execute(
      this.database.db,
    );
    for (const message of rows) {
      try {
        await this.handle(message);
      } catch (error) {
        // [PATTERN] Lỗi ở phía shipping, ví dụ đang lệch schema, chỉ làm sự kiện chờ: message chưa archive sẽ hiện lại sau
        // visibility timeout. Sự cố dừng ở đây, order-service không biết gì.
        logEvent({ service: 'shipping-service', event: 'order_event_failed', msgId: message.msg_id, error: String(error) });
      }
    }
  }

  private handle(message: QueueMessage): Promise<void> {
    const translation = translateOrderEvent(message.message);
    return this.database.db.transaction().execute(async (trx) => {
      if (translation.kind === 'apply') {
        await this.upsert(trx, translation.update);
      } else {
        await trx
          .insertInto('quarantined_events')
          .values({ msg_id: message.msg_id, reason: translation.reason, payload: JSON.stringify(message.message) })
          .onConflict((conflict) => conflict.column('msg_id').doNothing())
          .execute();
      }
      await sql`SELECT pgmq.archive('order_events', ${message.msg_id}::bigint)`.execute(trx);
    });
  }

  private async upsert(trx: Transaction<ShippingTables>, update: ShipmentOrderUpdate): Promise<void> {
    const address = this.config.addressModel === 'split' ? splitAddress(update.address) : { address: update.address };
    const fields = {
      ...address,
      delivery_window: update.deliveryWindow,
      zone_code: update.zoneCode,
      order_version: update.orderVersion,
      event_occurred_at: update.occurredAt,
      replicated_at: sql<Date>`clock_timestamp()`,
    };
    // [PATTERN] Idempotent: khóa theo order_id, và chỉ phiên bản mới hơn được ghi đè, nên sự kiện trùng hay tới muộn
    // không tạo dòng thứ hai và không kéo địa chỉ về bản cũ.
    await trx
      .insertInto('shipment_orders')
      .values({ order_id: update.orderId, ...fields })
      .onConflict((conflict) =>
        conflict
          .column('order_id')
          .doUpdateSet(fields)
          .whereRef('excluded.order_version', '>', 'shipment_orders.order_version'),
      )
      .execute();
    logEvent({
      service: 'shipping-service',
      event: 'shipment_order_replicated',
      correlationId: update.correlationId,
      orderId: update.orderId,
    });
  }
}
