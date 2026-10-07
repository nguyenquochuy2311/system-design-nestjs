import type {
  CustomerAccount,
  NewOrder,
  OrderRepositories,
  OrderUnitOfWork,
} from '../../src/sau/orders/application/order-repository';
import type { CatalogProduct, CustomerTier } from '../../src/sau/orders/domain/order';

/**
 * Bản giả của OrderUnitOfWork trong bộ nhớ: đủ để test service và cả module NestJS không cần PostgreSQL.
 * Lỗi trong `run` thì bỏ các đơn đã ghi trong lần chạy đó, giống rollback.
 */
export class InMemoryOrderUnitOfWork implements OrderUnitOfWork {
  readonly customers = new Map<number, CustomerAccount>();
  readonly products = new Map<number, CatalogProduct>();
  readonly orders: (NewOrder & { id: number; status: 'unpaid' | 'paid' })[] = [];
  readonly stats = { committed: 0, rolledBack: 0 };
  private nextId = 1;

  addCustomer(tier: CustomerTier, creditLimit: number): CustomerAccount {
    const id = this.nextId++;
    const customer = { id, name: `Khách ${id}`, email: `khach-${id}@example.test`, tier, creditLimit };
    this.customers.set(id, customer);
    return customer;
  }

  addProduct(unitPrice: number, isPromo = false): CatalogProduct {
    const product = { id: this.nextId++, unitPrice, isPromo };
    this.products.set(product.id, product);
    return product;
  }

  /** Công nợ đang có: một đơn chưa thanh toán không có dòng hàng. */
  addUnpaidOrder(customerId: number, total: number): void {
    this.orders.push({ id: this.nextId++, status: 'unpaid', customerId, channel: 'web', externalRef: null, subtotal: total, discount: 0, total, lines: [] });
  }

  ordersOf(customerId: number) {
    return this.orders.filter((o) => o.customerId === customerId);
  }

  async run<T>(work: (repos: OrderRepositories) => Promise<T>): Promise<T> {
    const before = this.orders.length;
    try {
      const result = await work(this.repositories());
      this.stats.committed++;
      return result;
    } catch (error) {
      this.orders.length = before;
      this.stats.rolledBack++;
      throw error;
    }
  }

  private repositories(): OrderRepositories {
    return {
      customers: { findForUpdate: async (id) => this.customers.get(id) },
      products: { findByIds: async (ids) => ids.flatMap((id) => this.products.get(id) ?? []) },
      orders: {
        outstandingDebt: async (customerId) =>
          this.ordersOf(customerId).filter((o) => o.status === 'unpaid').reduce((sum, o) => sum + o.total, 0),
        insert: async (order) => {
          const id = this.nextId++;
          this.orders.push({ ...order, id, status: 'unpaid' });
          return id;
        },
      },
    };
  }
}
