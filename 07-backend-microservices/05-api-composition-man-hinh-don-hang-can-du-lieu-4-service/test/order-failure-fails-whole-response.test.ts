import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logs, ORDER_OF_KH1, ORDER_OF_KH2, Stack } from './support/stack';

describe('Nguồn bắt buộc và quyền xem', () => {
  let stack: Stack;

  beforeEach(async () => {
    logs.length = 0;
    stack = await new Stack().start();
  });
  afterEach(() => stack.stop());

  const tier2Requests = () =>
    stack.behaviors.payment.requests + stack.behaviors.shipping.requests + stack.behaviors.customer.requests;

  it('order lỗi thì lỗi cả phản hồi, không gọi xuống tầng 2', async () => {
    stack.behaviors.order.failing = true;

    const reply = await stack.detail(ORDER_OF_KH1);

    expect(reply.status).toBe(502);
    expect(tier2Requests()).toBe(0);
  });

  it('đơn không tồn tại trả 404', async () => {
    expect((await stack.detail('DH-KHONG-CO')).status).toBe(404);
  });

  it('khách A không xem được đơn của khách B, và không có lời gọi tầng 2 nào', async () => {
    const reply = await stack.detail(ORDER_OF_KH2, 'KH-1');

    expect(reply.status).toBe(403);
    expect(tier2Requests()).toBe(0);
  });

  it('khách không xem được danh sách của khách khác, kể cả không gọi order-service', async () => {
    const reply = await stack.list('KH-2', 'KH-1');

    expect(reply.status).toBe(403);
    expect(stack.behaviors.order.requests).toBe(0);
  });

  it('CSKH xem được mọi đơn', async () => {
    expect((await stack.detail(ORDER_OF_KH2, 'NV-1', 'support')).status).toBe(200);
  });

  it('một correlation id đi theo mọi lời gọi xuống provider', async () => {
    await stack.detail(ORDER_OF_KH1);

    const outbound = logs.filter((line) => line.event === 'outbound');
    expect(outbound.map((line) => line.source).sort()).toEqual(['customer', 'order', 'payment', 'shipping']);
    expect(new Set(outbound.map((line) => line.correlationId)).size).toBe(1);
  });
});
