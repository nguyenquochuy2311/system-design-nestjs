/**
 * Đếm đơn vượt hạn mức được chấp nhận qua từng đường vào của hai bản, trên PostgreSQL thật.
 * Mỗi (bản, đường vào) đặt PER_GROUP đơn cho mỗi nhóm, mỗi đơn một khách mới:
 *   - "nợ cũ + đơn mới": hạn mức 100 triệu, đang nợ 80 triệu, đơn 28,5 triệu (sau chiết khấu Vàng 5%);
 *   - "riêng đơn đã vượt": hạn mức 20 triệu, không nợ, cùng đơn 28,5 triệu.
 * Kết quả đối chiếu lại bằng SQL (số đơn thật sự nằm trong bảng orders).
 *   RUN=main PER_GROUP=50 pnpm bench:over-limit     # kết quả: bench/results/<RUN>/over-limit.json
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { ENTRY_POINTS, placeVia, startApp, VARIANTS } from '../test/support/apps';
import { addUnpaidOrder, createCustomer, createProduct } from '../test/support/db-fixtures';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const PER_GROUP = Number(process.env.PER_GROUP ?? 50);
mkdirSync(OUT, { recursive: true });

const GROUPS = [
  { name: 'nợ cũ + đơn mới', creditLimit: 100_000_000, outstanding: 80_000_000 },
  { name: 'riêng đơn đã vượt', creditLimit: 20_000_000, outstanding: 0 },
];

const ctx = await startApp();
const productId = await createProduct(ctx.db, 1_000_000);
const rows: Record<string, unknown>[] = [];

for (const variant of VARIANTS) {
  for (const entry of ENTRY_POINTS) {
    for (const group of GROUPS) {
      const customerIds: number[] = [];
      let accepted = 0;
      let acceptedOverLimit = 0; // tổng số tiền vượt hạn mức của các đơn đã nhận
      for (let i = 0; i < PER_GROUP; i++) {
        const customerId = await createCustomer(ctx.db, 'gold', group.creditLimit);
        if (group.outstanding > 0) await addUnpaidOrder(ctx.db, customerId, group.outstanding);
        customerIds.push(customerId);
        const outcome = await placeVia(ctx.app, variant, entry, customerId, [{ productId, quantity: 30 }]);
        if (outcome.accepted) {
          accepted++;
          acceptedOverLimit += group.outstanding + outcome.total - group.creditLimit;
        }
      }
      // Đối chiếu độc lập: đơn mới trong DB (không tính đơn công nợ dựng sẵn, kênh khác 'web' hoặc có dòng hàng).
      const { rows: db } = await sql<{ orders: number }>`
        SELECT count(*)::int AS orders FROM orders o
        WHERE o.customer_id = ANY(${customerIds}::bigint[])
          AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)`.execute(ctx.db);
      const row = { variant, entry, group: group.name, attempted: PER_GROUP, accepted, ordersInDb: db[0]?.orders, acceptedOverLimit };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

writeFileSync(join(OUT, 'over-limit.json'), JSON.stringify({ perGroup: PER_GROUP, groups: GROUPS, rows }, null, 2));
await ctx.app.close();
