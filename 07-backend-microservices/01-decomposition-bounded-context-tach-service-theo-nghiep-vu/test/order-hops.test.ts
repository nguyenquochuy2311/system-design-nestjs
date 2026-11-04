import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectAdmin,
  logs,
  placeOrder,
  resetData,
  startSau,
  startTruoc,
  TWO_SKU_ORDER,
  TWO_SKU_TOTAL_VND,
  type SauStack,
  type TruocStack,
} from './support/stack';

function trace(correlationId: string) {
  const lines = logs.filter((line) => line.correlationId === correlationId);
  return {
    services: [...new Set(lines.map((line) => line.service))].sort(),
    outboundTargets: lines.filter((line) => line.event === 'outbound').map((line) => line.target),
  };
}

describe('Số service và số lần gọi mạng của một đơn 2 SKU', () => {
  let admin: pg.Pool;
  let stack: SauStack | TruocStack | undefined;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    logs.length = 0;
    await resetData(admin);
  });
  afterEach(() => stack?.stopAll());

  it('trước: 9 lời gọi tuần tự qua 5 entity service', async () => {
    stack = await startTruoc();
    const correlationId = randomUUID();

    const reply = await placeOrder(stack.entryUrl, TWO_SKU_ORDER, correlationId);

    expect(reply.status).toBe(201);
    expect(reply.body.totalVnd).toBe(TWO_SKU_TOTAL_VND);
    const { services, outboundTargets } = trace(correlationId);
    expect(outboundTargets).toEqual([
      'user-service',
      'product-service',
      'product-service',
      'stock-service',
      'stock-service',
      'stock-service',
      'stock-service',
      'payment-service',
      'order-service',
    ]);
    expect(services).toEqual([
      'checkout-api',
      'order-service',
      'payment-service',
      'product-service',
      'stock-service',
      'user-service',
    ]);
  });

  it('sau: 2 lời gọi, chỉ qua Ordering, Inventory và Payment', async () => {
    stack = await startSau();
    const correlationId = randomUUID();

    const reply = await placeOrder(stack.entryUrl, TWO_SKU_ORDER, correlationId);

    expect(reply.status).toBe(201);
    expect(reply.body.totalVnd).toBe(TWO_SKU_TOTAL_VND);
    const { services, outboundTargets } = trace(correlationId);
    expect(outboundTargets).toEqual(['inventory', 'payment']);
    expect(services).toEqual(['inventory', 'ordering', 'payment']);
  });
});
