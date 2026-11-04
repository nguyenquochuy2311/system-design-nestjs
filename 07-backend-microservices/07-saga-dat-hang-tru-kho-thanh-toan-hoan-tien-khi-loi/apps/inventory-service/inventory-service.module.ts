import { Inject, Injectable, Module, type DynamicModule, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../../libs/platform/database';
import { archiveMessage, QueueConsumer, sendMessage } from '../../libs/platform/queue';

const POLL_MS = Symbol('POLL_MS');

type InventoryCommand =
  | { type: 'ReserveStock'; sagaId: string; sku: string; quantity: number }
  | { type: 'ReleaseStock'; sagaId: string };

@Injectable()
class InventoryHandlers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumer: QueueConsumer<InventoryCommand>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(POLL_MS) pollMs: number,
  ) {
    this.consumer = new QueueConsumer(
      db,
      { service: 'inventory-service', queue: 'inventory_commands', visibilitySeconds: 2, batchSize: 50, pollMs },
      (msgId, command) => this.onCommand(msgId, command),
    );
  }

  onApplicationBootstrap(): void {
    this.consumer.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.consumer.stop();
  }

  // Việc của kho, trả lời cho orchestrator và archive lệnh cùng một transaction: lệnh tới hai lần cũng chỉ có một kết quả.
  private onCommand(msgId: number, command: InventoryCommand): Promise<void> {
    return this.db.transaction(async (tx) => {
      const replyType = command.type === 'ReserveStock' ? await this.reserve(tx, command) : await this.release(tx, command.sagaId);
      await sendMessage(tx, 'saga_replies', { type: replyType, sagaId: command.sagaId });
      await archiveMessage(tx, 'inventory_commands', msgId);
    });
  }

  private async reserve(tx: PoolClient, command: Extract<InventoryCommand, { type: 'ReserveStock' }>) {
    const created = await tx.query(
      `INSERT INTO inventory.reservations (saga_id, sku, quantity, status) VALUES ($1, $2, $3, 'RESERVED')
       ON CONFLICT (saga_id) DO NOTHING`,
      [command.sagaId, command.sku, command.quantity],
    );
    if (created.rowCount === 0) {
      // Lệnh trùng, hoặc lệnh tới muộn sau khi saga đã bù: trả lại đúng kết quả cũ, không giữ thêm hàng.
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM inventory.reservations WHERE saga_id = $1', [
        command.sagaId,
      ]);
      const status = rows[0]?.status;
      return status === 'RESERVED' ? 'StockReserved' : status === 'RELEASED' ? 'StockReleased' : 'OutOfStock';
    }
    const stock = await tx.query(
      'UPDATE inventory.stock_items SET reserved = reserved + $2 WHERE sku = $1 AND on_hand - reserved >= $2',
      [command.sku, command.quantity],
    );
    if (stock.rowCount === 0) {
      await tx.query("UPDATE inventory.reservations SET status = 'REJECTED' WHERE saga_id = $1", [command.sagaId]);
      return 'OutOfStock';
    }
    return 'StockReserved';
  }

  // [PATTERN] Bước bù idempotent theo saga: chỉ dòng còn RESERVED mới được nhả, nên tới hai lần cũng chỉ nhả một lần.
  private async release(tx: PoolClient, sagaId: string) {
    // Chèn tombstone trước: nếu lệnh giữ hàng đang chạy song song, câu này chờ nó commit rồi mới đi tiếp, nên câu UPDATE
    // dưới luôn thấy dòng đó. Làm ngược lại thì UPDATE bỏ sót dòng chưa commit và hàng bị giữ vĩnh viễn.
    // Bù tới trước lệnh giữ hàng thì tombstone ở lại, lệnh giữ hàng tới muộn sẽ không giữ gì.
    await tx.query(
      "INSERT INTO inventory.reservations (saga_id, sku, quantity, status) VALUES ($1, '-', 0, 'RELEASED') ON CONFLICT (saga_id) DO NOTHING",
      [sagaId],
    );
    const { rows } = await tx.query<{ sku: string; quantity: number }>(
      "UPDATE inventory.reservations SET status = 'RELEASED' WHERE saga_id = $1 AND status = 'RESERVED' RETURNING sku, quantity",
      [sagaId],
    );
    const released = rows[0];
    if (released) {
      await tx.query('UPDATE inventory.stock_items SET reserved = reserved - $2 WHERE sku = $1', [released.sku, released.quantity]);
    }
    return 'StockReleased';
  }
}

@Module({})
export class InventoryServiceModule {
  static register(databaseUrl: string, pollMs: number): DynamicModule {
    return {
      module: InventoryServiceModule,
      providers: [
        InventoryHandlers,
        { provide: POLL_MS, useValue: pollMs },
        { provide: Database, useFactory: () => new Database(databaseUrl) },
      ],
    };
  }
}
