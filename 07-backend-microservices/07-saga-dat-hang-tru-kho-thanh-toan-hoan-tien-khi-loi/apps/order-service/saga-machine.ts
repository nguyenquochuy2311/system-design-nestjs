export type SagaState = 'RESERVING' | 'CHARGING' | 'VOIDING' | 'COMPENSATING' | 'CONFIRMED' | 'CANCELLED';

export type SagaEvent =
  | 'StockReserved'
  | 'OutOfStock'
  | 'PaymentSucceeded'
  | 'PaymentFailed'
  | 'PaymentVoided'
  | 'StockReleased'
  | 'DeadlineReached';

export type SagaCommand = 'ChargePayment' | 'VoidPayment' | 'ReleaseStock';

export interface Decision {
  next: SagaState;
  command?: SagaCommand;
}

/**
 * [PATTERN] Toàn bộ quy tắc của saga nằm trong bảng này, không có I/O nên test được mọi tổ hợp.
 * Tổ hợp không có trong bảng là trả lời trùng hoặc tới muộn: bỏ qua, không phải lỗi.
 *
 * Hạn chót không bao giờ nhả hàng khi còn đang trừ tiền: kết quả có thể chưa biết, nên phải chốt với cổng trước (VOIDING).
 * Cổng đã trừ thì hoàn tiền, chưa trừ thì khóa key; chỉ sau đó mới bù kho.
 */
const TRANSITIONS: Partial<Record<SagaState, Partial<Record<SagaEvent, Decision>>>> = {
  RESERVING: {
    StockReserved: { next: 'CHARGING', command: 'ChargePayment' },
    OutOfStock: { next: 'CANCELLED' },
    DeadlineReached: { next: 'COMPENSATING', command: 'ReleaseStock' },
  },
  CHARGING: {
    PaymentSucceeded: { next: 'CONFIRMED' },
    PaymentFailed: { next: 'COMPENSATING', command: 'ReleaseStock' },
    DeadlineReached: { next: 'VOIDING', command: 'VoidPayment' },
  },
  VOIDING: {
    PaymentVoided: { next: 'COMPENSATING', command: 'ReleaseStock' },
  },
  COMPENSATING: {
    StockReleased: { next: 'CANCELLED' },
  },
};

export function decide(state: SagaState, event: SagaEvent): Decision | undefined {
  return TRANSITIONS[state]?.[event];
}
