import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrderDetail } from '../apps/truoc/legacy-client';
import { ORDER_OF_KH1, Stack } from './support/stack';

describe('Một nguồn tùy chọn gặp sự cố', () => {
  let stack: Stack;

  beforeEach(async () => {
    stack = await new Stack().start();
  });
  afterEach(() => stack.stop());

  it('bình thường: một request trả đủ bốn nguồn, không thiếu gì', async () => {
    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      order: { id: 'DH-1', customer_id: 'KH-1' },
      payment: { status: 'PAID' },
      shipping: { status: 'DELIVERING' },
      customer: { id: 'KH-1' },
      partial: [],
    });
  });

  it('sau: shipping quá timeout thì vẫn trả 200 kèm partial', async () => {
    stack.behaviors.shipping.delayMs = 1_000;

    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ shipping: null, partial: ['shipping'], payment: { status: 'PAID' } });
    expect(reply.ms).toBeLessThan(500);
  });

  it('sau: shipping trả lỗi thì vẫn trả 200 kèm partial', async () => {
    stack.behaviors.shipping.failing = true;

    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.status).toBe(200);
    expect(reply.body.partial).toEqual(['shipping']);
  });

  it('sau: nhiều nguồn tùy chọn lỗi cùng lúc thì liệt kê đủ', async () => {
    stack.behaviors.shipping.failing = true;
    stack.behaviors.customer.failing = true;

    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.status).toBe(200);
    expect(reply.body.partial).toEqual(['shipping', 'customer']);
  });

  it('trước: client tự ghép, shipping lỗi là lỗi toàn trang', async () => {
    stack.behaviors.shipping.failing = true;

    await expect(loadOrderDetail(stack.urls, ORDER_OF_KH1)).rejects.toThrow();
  });
});
