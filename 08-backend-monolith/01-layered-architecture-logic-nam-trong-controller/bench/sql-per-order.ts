/**
 * Ghi lại các câu SQL của một đơn web ở mỗi bản (đếm qua log của Kysely), để biết phép so độ trễ HTTP
 * có cùng số vòng gọi DB hay không.   RUN=main pnpm bench:sql   # bench/results/<RUN>/sql-per-order.json
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { startApp, VARIANTS } from '../test/support/apps';
import { createCustomer, createProduct } from '../test/support/db-fixtures';

const OUT = join('bench/results', process.env.RUN ?? 'main');
mkdirSync(OUT, { recursive: true });
const queries: string[] = [];
const ctx = await startApp((sql) => queries.push(sql.replace(/\s+/g, ' ').trim()));
const customerId = await createCustomer(ctx.db, 'silver', 1_000_000_000);
const productIds = await Promise.all([createProduct(ctx.db, 100_000), createProduct(ctx.db, 200_000, true)]);
const result: Record<string, { status: number; count: number; statements: string[] }> = {};
for (const variant of VARIANTS) {
  queries.length = 0;
  const res = await request(ctx.app.getHttpServer())
    .post(`/${variant}/orders`)
    .send({ customerId, items: productIds.map((productId) => ({ productId, quantity: 2 })) });
  result[variant] = { status: res.status, count: queries.length, statements: [...queries] };
}
writeFileSync(join(OUT, 'sql-per-order.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
await ctx.app.close();
