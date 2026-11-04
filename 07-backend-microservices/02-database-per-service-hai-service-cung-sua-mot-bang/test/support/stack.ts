import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import pg from 'pg';
import { OrderServiceModule } from '../../apps/order-service/order-service.module';
import type { ShippingConfig } from '../../apps/shipping-service/shipping-config';
import { ShippingServiceModule } from '../../apps/shipping-service/shipping-service.module';
import { TruocOrderModule, TruocShippingModule } from '../../apps/truoc/truoc.module';
import { setLogSink, type LogEntry } from '../../libs/platform/log';
import { applyMigrations } from '../../libs/platform/migrate';
import { createServiceApp } from '../../libs/platform/service-app';

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;

export const DATABASE_URLS = {
  admin: process.env.ADMIN_DATABASE_URL ?? url('postgres'),
  order: process.env.ORDER_DATABASE_URL ?? url('order_rw'),
  shipping: process.env.SHIPPING_DATABASE_URL ?? url('shipping_rw'),
  truocOrder: process.env.TRUOC_ORDER_DATABASE_URL ?? url('truoc_order'),
  truocShipping: process.env.TRUOC_SHIPPING_DATABASE_URL ?? url('truoc_shipping'),
};

const file = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

export const logs: LogEntry[] = [];
setLogSink((entry) => logs.push(entry));

export function connectAdmin(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URLS.admin, max: 3 });
}

export const orderingMigrations = () => ({
  connectionString: DATABASE_URLS.order,
  schema: 'ordering',
  directory: new URL('../../apps/order-service/migrations', import.meta.url).pathname,
});

export const shippingMigrations = () => ({
  connectionString: DATABASE_URLS.shipping,
  schema: 'shipping',
  directory: new URL('../../apps/shipping-service/migrations', import.meta.url).pathname,
});

/** Dựng lại cả hai bản từ chính file của lab: schema trống, migration 001 của từng service, chạy bằng role của service đó. */
export async function resetDatabase(admin: pg.Pool): Promise<void> {
  logs.length = 0;
  await admin.query(`
    DROP SCHEMA ordering CASCADE;
    CREATE SCHEMA ordering AUTHORIZATION order_rw;
    DROP SCHEMA shipping CASCADE;
    CREATE SCHEMA shipping AUTHORIZATION shipping_rw;
    SELECT pgmq.purge_queue('order_events');
    DELETE FROM pgmq.a_order_events;`);
  await admin.query(file('db/init/02-truoc.sql'));
  await applyMigrations(orderingMigrations(), '001');
  await applyMigrations(shippingMigrations(), '001');
  await admin.query("INSERT INTO shared.shops (id, name) VALUES ('SHOP-1', 'Shop 1')");
  await admin.query("INSERT INTO ordering.shops (id, name) VALUES ('SHOP-1', 'Shop 1')");
}

export const splitAddressSql = () => file('db/truoc/split-address.sql');

async function listen(name: string, module: DynamicModule): Promise<{ app: INestApplication; url: string }> {
  const app = await createServiceApp(name, module);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

export class SauStack {
  private shipping: INestApplication | undefined;
  orderUrl = '';
  shippingUrl = '';

  private constructor(private readonly order: INestApplication) {}

  static async start(addressModel: ShippingConfig['addressModel'] = 'single'): Promise<SauStack> {
    const order = await listen('order-service', OrderServiceModule.register(DATABASE_URLS.order));
    const stack = new SauStack(order.app);
    stack.orderUrl = order.url;
    await stack.startShipping(addressModel);
    return stack;
  }

  async startShipping(addressModel: ShippingConfig['addressModel']): Promise<void> {
    const shipping = await listen(
      'shipping-service',
      ShippingServiceModule.register({ databaseUrl: DATABASE_URLS.shipping, addressModel, pollMs: 20 }),
    );
    this.shipping = shipping.app;
    this.shippingUrl = shipping.url;
  }

  async stopShipping(): Promise<void> {
    await this.shipping?.close();
    this.shipping = undefined;
  }

  async stopAll(): Promise<void> {
    await this.stopShipping();
    await this.order.close();
  }
}

export class TruocStack {
  private constructor(
    private readonly apps: INestApplication[],
    readonly orderUrl: string,
    readonly shippingUrl: string,
  ) {}

  static async start(): Promise<TruocStack> {
    const order = await listen('truoc-order', TruocOrderModule.register(DATABASE_URLS.truocOrder));
    const shipping = await listen('truoc-shipping', TruocShippingModule.register(DATABASE_URLS.truocShipping));
    return new TruocStack([order.app, shipping.app], order.url, shipping.url);
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.apps.map((app) => app.close()));
  }
}

export const NEW_ORDER = {
  shopId: 'SHOP-1',
  address: '12 Lê Lợi, Phường Bến Nghé, Quận 1',
  deliveryWindow: '08:00-12:00',
  zoneCode: 'Z1',
  totalVnd: 150_000,
  items: [{ sku: 'SKU-1', quantity: 2 }],
};

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export async function send(method: string, target: string, body?: unknown, timeoutMs = 5_000): Promise<Reply> {
  const response = await fetch(target, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: (await response.json()) as Reply['body'] };
}

export const createOrder = (orderUrl: string, body: unknown = NEW_ORDER, timeoutMs?: number) =>
  send('POST', `${orderUrl}/orders`, body, timeoutMs);

export async function waitUntil(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
}

export async function countRows(admin: pg.Pool, table: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

export async function sendOrderEvent(admin: pg.Pool, event: unknown): Promise<void> {
  await admin.query("SELECT pgmq.send('order_events', $1::jsonb)", [JSON.stringify(event)]);
}
