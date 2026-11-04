import { randomUUID } from 'node:crypto';
import { Body, ConflictException, Controller, Inject, Module, Post, type DynamicModule } from '@nestjs/common';
import { Database } from '../../libs/platform/database';

const HOLD_MINUTES = 15;

interface ReserveRequest {
  orderId: string;
  lines: { sku: string; quantity: number }[];
}

@Controller('reservations')
class ReservationController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Một lời gọi giữ cả đơn trong một transaction: thiếu một SKU thì không SKU nào bị giữ. */
  @Post()
  reserve(@Body() body: ReserveRequest) {
    // Khóa dòng theo thứ tự SKU để hai đơn cùng SKU không chờ nhau thành deadlock.
    const lines = [...body.lines].sort((a, b) => a.sku.localeCompare(b.sku));
    return this.db.transaction(async (tx) => {
      for (const line of lines) {
        const { rowCount } = await tx.query(
          'UPDATE inventory.stock_items SET reserved = reserved + $2 WHERE sku = $1 AND on_hand - reserved >= $2',
          [line.sku, line.quantity],
        );
        if (rowCount === 0) {
          throw new ConflictException(`Không đủ hàng ${line.sku}`);
        }
        await tx.query(
          `INSERT INTO inventory.reservations (id, order_id, sku, quantity, expires_at)
           VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
          [randomUUID(), body.orderId, line.sku, line.quantity, HOLD_MINUTES],
        );
      }
      return { orderId: body.orderId, holdMinutes: HOLD_MINUTES };
    });
  }
}

@Module({})
export class InventoryModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: InventoryModule,
      controllers: [ReservationController],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl) }],
    };
  }
}
