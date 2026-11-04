import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../libs/platform/database';
import type { OrderLine, ProductSnapshot } from './pricing';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'FAILED';

interface SnapshotRow {
  sku: string;
  product_name: string;
  unit_price_vnd: number;
}

@Injectable()
export class OrderRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  async isActiveCustomer(customerId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ active: boolean }>('SELECT active FROM ordering.customers WHERE id = $1', [
      customerId,
    ]);
    return rows[0]?.active === true;
  }

  async findPercentOff(code: string): Promise<number | undefined> {
    const { rows } = await this.db.query<{ percent_off: number }>(
      'SELECT percent_off FROM ordering.promotions WHERE code = $1',
      [code],
    );
    return rows[0]?.percent_off;
  }

  async findSnapshots(skus: string[]): Promise<Map<string, ProductSnapshot>> {
    const { rows } = await this.db.query<SnapshotRow>(
      'SELECT sku, product_name, unit_price_vnd FROM ordering.product_snapshots WHERE sku = ANY($1)',
      [skus],
    );
    return new Map(
      rows.map((row) => [
        row.sku,
        { sku: row.sku, productName: row.product_name, unitPriceVnd: row.unit_price_vnd },
      ]),
    );
  }

  createPending(orderId: string, customerId: string, totalVnd: number, lines: OrderLine[]): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx.query("INSERT INTO ordering.orders (id, customer_id, status, total_vnd) VALUES ($1, $2, 'PENDING', $3)", [
        orderId,
        customerId,
        totalVnd,
      ]);
      await tx.query(
        `INSERT INTO ordering.order_lines (order_id, sku, product_name, unit_price_vnd, quantity)
         SELECT $1::uuid, * FROM unnest($2::text[], $3::text[], $4::bigint[], $5::int[])`,
        [
          orderId,
          lines.map((line) => line.sku),
          lines.map((line) => line.productName),
          lines.map((line) => line.unitPriceVnd),
          lines.map((line) => line.quantity),
        ],
      );
    });
  }

  async setStatus(orderId: string, status: OrderStatus): Promise<void> {
    await this.db.query('UPDATE ordering.orders SET status = $2 WHERE id = $1', [orderId, status]);
  }
}
