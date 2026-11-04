import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrderDetail } from '../apps/truoc/legacy-client';
import { ORDER_OF_KH1, Stack } from './support/stack';

const DELAY_MS = 60;

describe('Đồ thị phụ thuộc thay vì gọi tuần tự', () => {
  let stack: Stack;

  beforeEach(async () => {
    stack = await new Stack().start();
    for (const behavior of Object.values(stack.behaviors)) {
      behavior.delayMs = DELAY_MS;
    }
  });
  afterEach(() => stack.stop());

  it('sau: độ trễ xấp xỉ đơn cộng nguồn chậm nhất ở tầng 2', async () => {
    await stack.detail(ORDER_OF_KH1);

    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.ms).toBeGreaterThanOrEqual(2 * DELAY_MS);
    expect(reply.ms).toBeLessThan(3 * DELAY_MS);
  });

  it('trước: độ trễ là tổng bốn lời gọi', async () => {
    const startedAt = performance.now();

    await loadOrderDetail(stack.urls, ORDER_OF_KH1);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(4 * DELAY_MS);
  });
});
