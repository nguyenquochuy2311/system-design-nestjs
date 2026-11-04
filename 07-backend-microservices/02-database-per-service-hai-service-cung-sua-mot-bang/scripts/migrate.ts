/**
 * Mỗi service tự chạy migration của schema mình, bằng role của mình.
 *   pnpm exec tsx scripts/migrate.ts ordering
 *   pnpm exec tsx scripts/migrate.ts shipping --up-to 001
 */
import { parseArgs } from 'node:util';
import { applyMigrations } from '../libs/platform/migrate';

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;

const TARGETS = {
  ordering: {
    connectionString: process.env.ORDER_DATABASE_URL ?? url('order_rw'),
    schema: 'ordering',
    directory: 'apps/order-service/migrations',
  },
  shipping: {
    connectionString: process.env.SHIPPING_DATABASE_URL ?? url('shipping_rw'),
    schema: 'shipping',
    directory: 'apps/shipping-service/migrations',
  },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'up-to': { type: 'string' } },
});
const name = positionals[0];
if (name !== 'ordering' && name !== 'shipping') {
  throw new Error('Cần ordering hoặc shipping');
}
const files = await applyMigrations(TARGETS[name], values['up-to']);
console.log(`${name}: đã chạy ${files.length} migration ${files.join(', ')}`);
