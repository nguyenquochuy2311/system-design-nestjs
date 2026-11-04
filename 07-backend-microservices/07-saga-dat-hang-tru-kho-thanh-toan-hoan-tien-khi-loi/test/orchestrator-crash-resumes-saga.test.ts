import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAdmin, resetData, SagaStack, waitUntil } from './support/stack';

describe('Orchestrator tắt giữa chừng', () => {
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

  it('saga dở dang chạy tiếp từ trạng thái đã lưu và kết thúc đúng', async () => {
    stack.gateway.behavior.declineRate = 0.3;
    await Promise.all(Array.from({ length: 40 }, () => stack.place()));

    await stack.stopOrder();
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ordering.order_sagas WHERE state NOT IN ('CONFIRMED', 'CANCELLED')",
    );
    expect(rows[0]?.n).toBeGreaterThan(0);

    await stack.startOrder();
    await waitUntil(async () => (await stack.report(admin)).unfinished === 0, 'mọi saga kết thúc', 15_000);

    const report = await stack.report(admin);
    expect(report.orders).toBe(40);
    expect(report.mismatched).toBe(0);
  });

  it('tạo đơn lỗi lúc commit thì lệnh đã gửi cũng mất theo, không có lệnh mồ côi', async () => {
    await stack.stopInventory();
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.lab_fail() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'lỗi cố ý của test'; END $$;
      CREATE CONSTRAINT TRIGGER lab_fail AFTER INSERT ON ordering.orders
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.lab_fail();`);
    try {
      await expect(stack.place()).rejects.toThrow('500');

      const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM pgmq.q_inventory_commands');
      expect(rows[0]?.n).toBe(0);
    } finally {
      await admin.query('DROP TRIGGER lab_fail ON ordering.orders');
      await stack.startInventory();
    }
  });

  it('kho và thanh toán tắt rồi mở lại: lệnh còn trong hàng đợi, saga vẫn xong', async () => {
    await stack.stopInventory();
    await stack.stopPayment();

    const orderId = await stack.place();
    expect((await stack.view(orderId)).state).toBe('RESERVING');

    await stack.startInventory();
    await stack.startPayment();
    await waitUntil(async () => (await stack.view(orderId)).status === 'CONFIRMED', 'đơn xác nhận');
  });
});
