import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrderList } from '../apps/truoc/legacy-client';
import { Stack } from './support/stack';

describe('Màn hình danh sách 20 đơn', () => {
  let stack: Stack;

  beforeEach(async () => {
    stack = await new Stack().start();
  });
  afterEach(() => stack.stop());

  it('trước: 61 request xuống provider', async () => {
    const rows = await loadOrderList(stack.urls, 'KH-1');

    expect(rows).toHaveLength(20);
    expect(stack.requestsTotal()).toBe(61);
  });

  it('sau: đúng 4 request, một lời gọi lô cho mỗi provider', async () => {
    const reply = await stack.list('KH-1');

    expect(reply.body).toHaveLength(20);
    expect(stack.requestsTotal()).toBe(4);
    expect(stack.behaviors.payment.requests).toBe(1);
    expect(stack.behaviors.shipping.requests).toBe(1);
    expect(stack.behaviors.customer.requests).toBe(1);
  });

  it('mỗi đơn trong danh sách ghép đúng dữ liệu của nó', async () => {
    const { body } = await stack.list('KH-1');

    for (const row of body as { order: { id: string }; payment: { order_id: string }; shipping: { order_id: string } }[]) {
      expect(row.payment.order_id).toBe(row.order.id);
      expect(row.shipping.order_id).toBe(row.order.id);
    }
  });

  it('shipping lỗi thì mọi dòng đều báo thiếu shipping, danh sách vẫn hiện', async () => {
    stack.behaviors.shipping.failing = true;

    const reply = await stack.list('KH-1');

    expect(reply.status).toBe(200);
    expect(reply.body).toHaveLength(20);
    expect(reply.body.every((row) => (row.partial as string[]).includes('shipping'))).toBe(true);
  });

  it('cache của bộ gom lô không dùng chung giữa các request', async () => {
    await stack.list('KH-1');
    await stack.list('KH-1');

    expect(stack.behaviors.payment.requests).toBe(2);
  });
});
