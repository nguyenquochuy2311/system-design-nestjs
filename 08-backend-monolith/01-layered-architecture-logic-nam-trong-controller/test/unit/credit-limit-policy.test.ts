import { describe, expect, it } from 'vitest';
import { assertWithinCreditLimit } from '../../src/sau/orders/domain/credit-limit-policy';
import { CreditLimitExceededError } from '../../src/sau/orders/domain/order';

const position = { customerId: 42, creditLimit: 100_000_000, outstanding: 80_000_000 };

describe('CreditLimitPolicy: công nợ đang có + đơn mới ≤ hạn mức', () => {
  it('vừa đúng hạn mức thì được nhận', () => {
    expect(() => assertWithinCreditLimit(position, 20_000_000)).not.toThrow();
  });

  it('vượt 1 đồng thì báo CreditLimitExceeded kèm số còn thiếu', () => {
    let caught: unknown;
    try {
      assertWithinCreditLimit(position, 20_000_001);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CreditLimitExceededError);
    expect(caught).toMatchObject({ customerId: 42, shortfall: 1 });
  });

  it('công nợ đang có được cộng vào: đơn 30 triệu nhỏ hơn hạn mức vẫn bị từ chối', () => {
    expect(() => assertWithinCreditLimit(position, 30_000_000)).toThrow(CreditLimitExceededError);
  });
});
