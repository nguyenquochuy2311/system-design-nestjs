import { randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Param,
  Post,
  type DynamicModule,
} from '@nestjs/common';
import { Database } from '../../libs/platform/database';

export interface TruocUrls {
  inventoryUrl: string;
  paymentUrl: string;
}

const TRUOC_URLS = Symbol('TRUOC_URLS');
const GATEWAY = Symbol('GATEWAY');

interface PlaceOrder {
  sku: string;
  quantity: number;
  amountVnd: number;
}

const json = { 'content-type': 'application/json' };

// Quy trình chỉ nằm trong bộ nhớ của request này. Crash giữa chừng hoặc lời gọi hoàn kho lỗi thì không ai nhớ phải bù.
@Controller('orders')
class OrderController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(TRUOC_URLS) private readonly urls: TruocUrls,
  ) {}

  @Post()
  @HttpCode(200)
  async place(@Body() body: PlaceOrder) {
    const orderId = randomUUID();
    await this.db.query(
      "INSERT INTO truoc.orders (id, sku, quantity, amount_vnd, status) VALUES ($1, $2, $3, $4, 'PENDING')",
      [orderId, body.sku, body.quantity, body.amountVnd],
    );
    const reserved = await fetch(`${this.urls.inventoryUrl}/reservations`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ orderId, sku: body.sku, quantity: body.quantity }),
    });
    if (reserved.status !== 201) {
      await this.setStatus(orderId, 'CANCELLED');
      throw new ConflictException('Không đủ hàng');
    }
    try {
      const paid = await fetch(`${this.urls.paymentUrl}/charges`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ orderId, amountVnd: body.amountVnd }),
      });
      if (paid.status !== 201) {
        throw new Error(`payment trả ${paid.status}`);
      }
    } catch {
      // Mọi lỗi đều bị coi là thất bại, kể cả timeout: tiền có thể đã bị trừ mà đơn vẫn bị hủy.
      await fetch(`${this.urls.inventoryUrl}/reservations/${orderId}`, { method: 'DELETE' });
      await this.setStatus(orderId, 'CANCELLED');
      throw new HttpException('Thanh toán thất bại', 402);
    }
    await this.setStatus(orderId, 'CONFIRMED');
    return { orderId, status: 'CONFIRMED' };
  }

  private async setStatus(orderId: string, status: string): Promise<void> {
    await this.db.query('UPDATE truoc.orders SET status = $2 WHERE id = $1', [orderId, status]);
  }
}

@Controller('reservations')
class ReservationController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Post()
  reserve(@Body() body: { orderId: string; sku: string; quantity: number }) {
    return this.db.transaction(async (tx) => {
      const stock = await tx.query(
        'UPDATE truoc.stock_items SET reserved = reserved + $2 WHERE sku = $1 AND on_hand - reserved >= $2',
        [body.sku, body.quantity],
      );
      if (stock.rowCount === 0) {
        throw new ConflictException('Không đủ hàng');
      }
      await tx.query("INSERT INTO truoc.reservations (order_id, sku, quantity, status) VALUES ($1, $2, $3, 'RESERVED')", [
        body.orderId,
        body.sku,
        body.quantity,
      ]);
      return { reserved: true };
    });
  }

  @Delete(':orderId')
  release(@Param('orderId') orderId: string) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ sku: string; quantity: number }>(
        "UPDATE truoc.reservations SET status = 'RELEASED' WHERE order_id = $1 AND status = 'RESERVED' RETURNING sku, quantity",
        [orderId],
      );
      if (rows[0]) {
        await tx.query('UPDATE truoc.stock_items SET reserved = reserved - $2 WHERE sku = $1', [rows[0].sku, rows[0].quantity]);
      }
      return { released: true };
    });
  }
}

@Controller('charges')
class ChargeController {
  constructor(@Inject(GATEWAY) private readonly gateway: { url: string; timeoutMs: number }) {}

  @Post()
  async charge(@Body() body: { orderId: string; amountVnd: number }) {
    const response = await fetch(`${this.gateway.url}/charges`, {
      method: 'POST',
      headers: { ...json, 'idempotency-key': body.orderId },
      body: JSON.stringify({ amountVnd: body.amountVnd }),
      signal: AbortSignal.timeout(this.gateway.timeoutMs),
    });
    if (response.status !== 200) {
      throw new HttpException('Cổng từ chối', 402);
    }
    return { charged: true };
  }
}

@Module({})
export class TruocModule {
  static order(databaseUrl: string, urls: TruocUrls): DynamicModule {
    return {
      module: TruocModule,
      controllers: [OrderController],
      providers: [
        { provide: TRUOC_URLS, useValue: urls },
        { provide: Database, useFactory: () => new Database(databaseUrl) },
      ],
    };
  }

  static inventory(databaseUrl: string): DynamicModule {
    return {
      module: TruocModule,
      controllers: [ReservationController],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl) }],
    };
  }

  static payment(gatewayUrl: string, timeoutMs: number): DynamicModule {
    return {
      module: TruocModule,
      controllers: [ChargeController],
      providers: [{ provide: GATEWAY, useValue: { url: gatewayUrl, timeoutMs } }],
    };
  }
}
