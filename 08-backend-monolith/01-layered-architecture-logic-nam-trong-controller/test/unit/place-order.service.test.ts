import { beforeEach, describe, expect, it } from 'vitest';
import { PlaceOrderService } from '../../src/sau/orders/application/place-order.service';
import { CreditLimitExceededError, CustomerNotFoundError, UnknownProductError } from '../../src/sau/orders/domain/order';
import { RecordingMailer } from '../../src/shared/mailer';
import { InMemoryOrderUnitOfWork } from '../support/in-memory-unit-of-work';

let uow: InMemoryOrderUnitOfWork;
let mailer: RecordingMailer;
let service: PlaceOrderService;

beforeEach(() => {
  uow = new InMemoryOrderUnitOfWork();
  mailer = new RecordingMailer();
  // Không cần NestJS hay DB: service chỉ phụ thuộc interface.
  service = new PlaceOrderService(uow, mailer);
});

describe('PlaceOrderService với repository giả trong bộ nhớ', () => {
  it('đơn hợp lệ được lưu đúng giá, đúng kênh, trong một transaction và có email xác nhận', async () => {
    const customer = uow.addCustomer('gold', 100_000_000);
    const product = uow.addProduct(1_000_000);

    const placed = await service.placeOrder({ customerId: customer.id, channel: 'csv', externalRef: 'DL-17', items: [{ productId: product.id, quantity: 4 }] });

    expect(placed).toMatchObject({ customerId: customer.id, subtotal: 4_000_000, discount: 200_000, total: 3_800_000 });
    expect(uow.ordersOf(customer.id)).toEqual([expect.objectContaining({ id: placed.orderId, channel: 'csv', externalRef: 'DL-17', total: 3_800_000 })]);
    expect(uow.stats).toEqual({ committed: 1, rolledBack: 0 });
    expect(mailer.sent).toEqual([expect.objectContaining({ to: customer.email, subject: `Xác nhận đơn #${placed.orderId}` })]);
  });

  it('đơn vượt hạn mức bị từ chối: không có đơn mới, transaction rollback, không gửi email', async () => {
    const customer = uow.addCustomer('gold', 100_000_000);
    uow.addUnpaidOrder(customer.id, 80_000_000);
    const product = uow.addProduct(1_000_000);

    await expect(service.placeOrder({ customerId: customer.id, channel: 'web', items: [{ productId: product.id, quantity: 30 }] })).rejects.toMatchObject(
      { constructor: CreditLimitExceededError, shortfall: 8_500_000 },
    );
    expect(uow.ordersOf(customer.id)).toHaveLength(1); // chỉ còn khoản công nợ cũ
    expect(uow.stats.rolledBack).toBe(1);
    expect(mailer.sent).toHaveLength(0);
  });

  it('khách không tồn tại báo CustomerNotFound; sản phẩm lạ báo UnknownProduct', async () => {
    await expect(service.placeOrder({ customerId: 999, channel: 'web', items: [{ productId: 1, quantity: 1 }] })).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
    const customer = uow.addCustomer('standard', 1_000_000);
    await expect(service.placeOrder({ customerId: customer.id, channel: 'web', items: [{ productId: 12345, quantity: 1 }] })).rejects.toBeInstanceOf(
      UnknownProductError,
    );
    expect(uow.orders).toHaveLength(0);
  });
});
