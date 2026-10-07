import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { KYSELY, type Database } from '../../../shared/db';
import type { CatalogProduct, CustomerTier } from '../domain/order';
import type {
  CustomerAccount,
  CustomerRepository,
  NewOrder,
  OrderRepositories,
  OrderRepository,
  OrderUnitOfWork,
  ProductRepository,
} from '../application/order-repository';

type Executor = Kysely<Database> | Transaction<Database>;

// [PATTERN] Repository: truy cập dữ liệu theo khái niệm nghiệp vụ, trả kiểu của domain/application,
// không để kiểu bảng của Kysely (Selectable<...>) rò lên service hay controller.

export class KyselyCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Executor) {}

  async findForUpdate(customerId: number): Promise<CustomerAccount | undefined> {
    const row = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'email', 'tier', 'credit_limit'])
      .where('id', '=', customerId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return undefined;
    return { id: row.id, name: row.name, email: row.email, tier: row.tier as CustomerTier, creditLimit: row.credit_limit };
  }
}

export class KyselyProductRepository implements ProductRepository {
  constructor(private readonly db: Executor) {}

  async findByIds(productIds: readonly number[]): Promise<CatalogProduct[]> {
    const rows = await this.db
      .selectFrom('products')
      .select(['id', 'unit_price', 'is_promo'])
      .where('id', '=', sql<number>`ANY(${[...productIds]}::bigint[])`)
      .execute();
    return rows.map((r) => ({ id: r.id, unitPrice: r.unit_price, isPromo: r.is_promo }));
  }
}

export class KyselyOrderRepository implements OrderRepository {
  constructor(private readonly db: Executor) {}

  async outstandingDebt(customerId: number): Promise<number> {
    const row = await this.db
      .selectFrom('orders')
      .select(sql<number>`COALESCE(SUM(total), 0)::bigint`.as('outstanding'))
      .where('customer_id', '=', customerId)
      .where('status', '=', 'unpaid')
      .executeTakeFirstOrThrow();
    return row.outstanding;
  }

  async insert(order: NewOrder): Promise<number> {
    const { id } = await this.db
      .insertInto('orders')
      .values({
        customer_id: order.customerId,
        channel: order.channel,
        external_ref: order.externalRef,
        subtotal: order.subtotal,
        discount: order.discount,
        total: order.total,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db
      .insertInto('order_items')
      .values(
        order.lines.map((l) => ({
          order_id: id,
          product_id: l.productId,
          quantity: l.quantity,
          unit_price: l.unitPrice,
          line_total: l.unitPrice * l.quantity,
        })),
      )
      .execute();
    return id;
  }
}

/** Mở transaction Kysely và đưa repository gắn với transaction đó cho service. */
@Injectable()
export class KyselyOrderUnitOfWork implements OrderUnitOfWork {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  run<T>(work: (repos: OrderRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) =>
      work({
        customers: new KyselyCustomerRepository(trx),
        products: new KyselyProductRepository(trx),
        orders: new KyselyOrderRepository(trx),
      }),
    );
  }
}
