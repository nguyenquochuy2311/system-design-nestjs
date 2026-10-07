import { CreditLimitExceededError } from './order';

export interface CreditPosition {
  customerId: number;
  creditLimit: number;
  /** Tổng giá trị các đơn chưa thanh toán. */
  outstanding: number;
}

// [PATTERN] Quy tắc hạn mức công nợ nằm đúng một chỗ: công nợ đang có cộng đơn mới không vượt hạn mức.
export function assertWithinCreditLimit(position: CreditPosition, orderTotal: number): void {
  const exposure = position.outstanding + orderTotal;
  if (exposure > position.creditLimit) {
    throw new CreditLimitExceededError(position.customerId, exposure - position.creditLimit);
  }
}
