import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, reservedOf, resetData, SagaStack, sendCommand, waitUntil } from './support/stack';

describe('Lệnh tới hai lần hoặc sai thứ tự', () => {
  let admin: pg.Pool;
  let stack: SagaStack;

  beforeAll(() => {
    admin = connectAdmin();
  });
  afterAll(() => admin.end());
  beforeEach(async () => {
    await resetData(admin);
    stack = await new SagaStack().startAll();
  });
  afterEach(() => stack.stopAll());

  const reserve = (sagaId: string) => ({ type: 'ReserveStock', sagaId, sku: 'SKU-0001', quantity: 5 });
  const release = (sagaId: string) => ({ type: 'ReleaseStock', sagaId });

  async function handled(queue: string, count: number): Promise<void> {
    await waitUntil(async () => {
      const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM pgmq.a_${queue}`);
      return rows[0]?.n === count;
    }, `${count} lệnh đã xử lý`);
  }

  it('ReserveStock hai lần chỉ giữ hàng một lần', async () => {
    const sagaId = randomUUID();

    await sendCommand(admin, 'inventory_commands', reserve(sagaId));
    await sendCommand(admin, 'inventory_commands', reserve(sagaId));
    await handled('inventory_commands', 2);

    expect(await reservedOf(admin)).toBe(5);
  });

  it('ReleaseStock hai lần chỉ nhả một lần', async () => {
    const sagaId = randomUUID();
    await sendCommand(admin, 'inventory_commands', reserve(sagaId));
    await handled('inventory_commands', 1);

    await sendCommand(admin, 'inventory_commands', release(sagaId));
    await sendCommand(admin, 'inventory_commands', release(sagaId));
    await handled('inventory_commands', 3);

    expect(await reservedOf(admin)).toBe(0);
  });

  it('bù tới trước lệnh giữ hàng: lệnh giữ hàng tới muộn không giữ gì', async () => {
    const sagaId = randomUUID();

    await sendCommand(admin, 'inventory_commands', release(sagaId));
    await handled('inventory_commands', 1);
    await sendCommand(admin, 'inventory_commands', reserve(sagaId));
    await handled('inventory_commands', 2);

    expect(await reservedOf(admin)).toBe(0);
  });

  it('giữ hàng và bù chạy song song nhiều lần: không saga nào bị giữ hàng oan', async () => {
    const sagaIds = Array.from({ length: 60 }, () => randomUUID());

    await Promise.all(
      sagaIds.flatMap((sagaId) => [
        sendCommand(admin, 'inventory_commands', reserve(sagaId)),
        sendCommand(admin, 'inventory_commands', release(sagaId)),
      ]),
    );
    await handled('inventory_commands', 120);

    expect(await reservedOf(admin)).toBe(0);
  });

  it('ChargePayment hai lần chỉ trừ tiền một lần', async () => {
    const sagaId = randomUUID();
    const charge = { type: 'ChargePayment', sagaId, amountVnd: 100_000 };

    await sendCommand(admin, 'payment_commands', charge);
    await sendCommand(admin, 'payment_commands', charge);
    await handled('payment_commands', 2);

    expect(stack.gateway.charges.get(sagaId)).toBe('CAPTURED');
    expect(stack.gateway.charges.size).toBe(1);
  });
});
