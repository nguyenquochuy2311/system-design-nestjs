import type { CatalogProduct, CustomerTier, OrderLine, SalesChannel } from '../domain/order';

// Interface repository đặt cạnh service (lớp application); hiện thực Kysely nằm ở infrastructure.
// Service chỉ biết các interface này nên test được bằng bản giả trong bộ nhớ, không cần DB.

export interface CustomerAccount {
  id: number;
  name: string;
  email: string;
  tier: CustomerTier;
  creditLimit: number;
}

export interface NewOrder {
  customerId: number;
  channel: SalesChannel;
  externalRef: string | null;
  subtotal: number;
  discount: number;
  total: number;
  lines: OrderLine[];
}

export interface CustomerRepository {
  /** Đọc và khóa khách hàng đến hết transaction, để hai đơn cùng lúc không cùng lọt hạn mức. */
  findForUpdate(customerId: number): Promise<CustomerAccount | undefined>;
}

export interface ProductRepository {
  findByIds(productIds: readonly number[]): Promise<CatalogProduct[]>;
}

export interface OrderRepository {
  /** Công nợ hiện tại: tổng giá trị đơn chưa thanh toán của khách. */
  outstandingDebt(customerId: number): Promise<number>;
  insert(order: NewOrder): Promise<number>;
}

export interface OrderRepositories {
  customers: CustomerRepository;
  products: ProductRepository;
  orders: OrderRepository;
}

/** Chạy `work` trong một transaction; repository đưa vào đều gắn với transaction đó. */
export interface OrderUnitOfWork {
  run<T>(work: (repos: OrderRepositories) => Promise<T>): Promise<T>;
}

export const ORDER_UNIT_OF_WORK = Symbol('ORDER_UNIT_OF_WORK');
