import { describe, expect, it } from 'vitest';
import { PlaceOrderService } from '../../src/sau/orders/application/place-order.service';
import { CreditLimitExceededError } from '../../src/sau/orders/domain/order';
import { RecordingMailer } from '../../src/shared/mailer';
import { InMemoryOrderUnitOfWork } from '../support/in-memory-unit-of-work';
import { ORDER_RULE_CASES } from '../support/order-rule-cases';

// Cùng bảng đặc tả với test/e2e/web-order-rules.e2e.test.ts, nhưng chạy qua service, không HTTP, không DB.
describe('sau: bảng quy tắc đặt hàng qua PlaceOrderService (không cần DB)', () => {
  it.each(ORDER_RULE_CASES)('$name', async (c) => {
    const uow = new InMemoryOrderUnitOfWork();
    const service = new PlaceOrderService(uow, new RecordingMailer());
    const customer = uow.addCustomer(c.tier, c.creditLimit);
    if (c.outstanding > 0) uow.addUnpaidOrder(customer.id, c.outstanding);
    const productIds = c.products.map((p) => uow.addProduct(p.unitPrice, p.isPromo).id);
    const items = c.items.map((i) => ({ productId: productIds[i.product] as number, quantity: i.quantity }));

    const result = service.placeOrder({ customerId: customer.id, channel: 'web', items });

    if (c.expected.kind === 'placed') {
      const { kind: _kind, ...money } = c.expected;
      await expect(result).resolves.toMatchObject({ customerId: customer.id, ...money });
    } else {
      await expect(result).rejects.toMatchObject({ constructor: CreditLimitExceededError, shortfall: c.expected.shortfall });
    }
  });
});
