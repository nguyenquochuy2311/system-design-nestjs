import { describe, expect, it } from 'vitest';
import { decide, type SagaEvent, type SagaState } from '../apps/order-service/saga-machine';

const STATES: SagaState[] = ['RESERVING', 'CHARGING', 'VOIDING', 'COMPENSATING', 'CONFIRMED', 'CANCELLED'];
const EVENTS: SagaEvent[] = [
  'StockReserved',
  'OutOfStock',
  'PaymentSucceeded',
  'PaymentFailed',
  'PaymentVoided',
  'StockReleased',
  'DeadlineReached',
];

describe('Máy trạng thái của saga', () => {
  it('luồng đúng: giữ hàng, thu tiền, xác nhận', () => {
    expect(decide('RESERVING', 'StockReserved')).toEqual({ next: 'CHARGING', command: 'ChargePayment' });
    expect(decide('CHARGING', 'PaymentSucceeded')).toEqual({ next: 'CONFIRMED' });
  });

  it('thanh toán bị từ chối thì bù kho, không cần gọi lại cổng', () => {
    expect(decide('CHARGING', 'PaymentFailed')).toEqual({ next: 'COMPENSATING', command: 'ReleaseStock' });
    expect(decide('COMPENSATING', 'StockReleased')).toEqual({ next: 'CANCELLED' });
  });

  it('hạn chót lúc đang trừ tiền không nhả hàng ngay, mà chốt với cổng trước', () => {
    expect(decide('CHARGING', 'DeadlineReached')).toEqual({ next: 'VOIDING', command: 'VoidPayment' });
    expect(decide('VOIDING', 'PaymentVoided')).toEqual({ next: 'COMPENSATING', command: 'ReleaseStock' });
  });

  it('hạn chót lúc còn giữ hàng thì bù, nên saga không kẹt ở RESERVING', () => {
    expect(decide('RESERVING', 'DeadlineReached')).toEqual({ next: 'COMPENSATING', command: 'ReleaseStock' });
  });

  it('trạng thái cuối bỏ qua mọi sự kiện', () => {
    for (const state of ['CONFIRMED', 'CANCELLED'] as const) {
      for (const event of EVENTS) {
        expect(decide(state, event)).toBeUndefined();
      }
    }
  });

  it('không có đường nào từ CHARGING thẳng sang CANCELLED, tức không hủy đơn khi chưa bù', () => {
    for (const event of EVENTS) {
      expect(decide('CHARGING', event)?.next).not.toBe('CANCELLED');
    }
  });

  it('mọi trạng thái chưa kết thúc đều có lối ra', () => {
    for (const state of STATES.filter((item) => item !== 'CONFIRMED' && item !== 'CANCELLED')) {
      expect(EVENTS.some((event) => decide(state, event))).toBe(true);
    }
  });

  it('trả lời muộn trong lúc đang hủy bị bỏ qua', () => {
    expect(decide('VOIDING', 'PaymentSucceeded')).toBeUndefined();
    expect(decide('COMPENSATING', 'PaymentSucceeded')).toBeUndefined();
  });
});
