import { randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  type DynamicModule,
  type Type,
} from '@nestjs/common';
import { Database } from '../../libs/platform/database';

// Tách theo bảng: mỗi service là một lớp CRUD mỏng, sở hữu dữ liệu nhưng không sở hữu quy tắc nào. Không service nào
// biết "đặt hàng" là gì; quy tắc đó nằm ở checkout-api. Các service trả nguyên dòng của bảng, nên tên cột chính là hợp
// đồng với mọi bên gọi.

function firstRow<Row>(rows: Row[], label: string): Row {
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Không có ${label}`);
  }
  return row;
}

@Controller('users')
class UserController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get(':id')
  async get(@Param('id') id: string) {
    const { rows } = await this.db.query('SELECT * FROM truoc.users WHERE id = $1', [id]);
    return firstRow(rows, `user ${id}`);
  }
}

@Controller('products')
class ProductController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get(':sku')
  async get(@Param('sku') sku: string) {
    const { rows } = await this.db.query('SELECT * FROM truoc.products WHERE sku = $1', [sku]);
    return firstRow(rows, `product ${sku}`);
  }
}

@Controller('stock')
class StockController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get(':sku')
  async get(@Param('sku') sku: string) {
    const { rows } = await this.db.query('SELECT * FROM truoc.stock WHERE sku = $1', [sku]);
    return firstRow(rows, `stock ${sku}`);
  }

  @Patch(':sku/reserve')
  async reserve(@Param('sku') sku: string, @Body() body: { quantity: number }) {
    const { rows } = await this.db.query(
      'UPDATE truoc.stock SET reserved = reserved + $2 WHERE sku = $1 AND on_hand - reserved >= $2 RETURNING *',
      [sku, body.quantity],
    );
    if (!rows[0]) {
      throw new ConflictException(`Không đủ hàng ${sku}`);
    }
    return rows[0];
  }
}

@Controller('promotions')
class PromotionController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get(':code')
  async get(@Param('code') code: string) {
    const { rows } = await this.db.query('SELECT * FROM truoc.promotions WHERE code = $1', [code]);
    return firstRow(rows, `promotion ${code}`);
  }
}

@Controller('payments')
class PaymentController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Post()
  async create(@Body() body: { orderId: string; amountVnd: number }) {
    const { rows } = await this.db.query(
      "INSERT INTO truoc.payments (id, order_id, amount_vnd, status) VALUES ($1, $2, $3, 'CAPTURED') RETURNING *",
      [randomUUID(), body.orderId, body.amountVnd],
    );
    return rows[0];
  }
}

@Controller('orders')
class OrderController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Post()
  async create(@Body() body: { id: string; customerId: string; totalVnd: number; lines: unknown[] }) {
    const { rows } = await this.db.query(
      "INSERT INTO truoc.orders (id, customer_id, status, total_vnd, lines) VALUES ($1, $2, 'CONFIRMED', $3, $4) RETURNING *",
      [body.id, body.customerId, body.totalVnd, JSON.stringify(body.lines)],
    );
    return rows[0];
  }
}

export const ENTITY_CONTROLLERS = {
  'user-service': UserController,
  'product-service': ProductController,
  'stock-service': StockController,
  'promotion-service': PromotionController,
  'payment-service': PaymentController,
  'order-service': OrderController,
} as const satisfies Record<string, Type<unknown>>;

export type EntityServiceName = keyof typeof ENTITY_CONTROLLERS;

@Module({})
export class EntityServiceModule {
  static register(name: EntityServiceName, databaseUrl: string): DynamicModule {
    return {
      module: EntityServiceModule,
      controllers: [ENTITY_CONTROLLERS[name]],
      providers: [{ provide: Database, useFactory: () => new Database(databaseUrl) }],
    };
  }
}
