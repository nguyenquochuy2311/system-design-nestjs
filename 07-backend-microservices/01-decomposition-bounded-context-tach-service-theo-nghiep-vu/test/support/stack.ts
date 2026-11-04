import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DynamicModule } from '@nestjs/common';
import pg from 'pg';
import { CatalogModule, type CatalogConfig } from '../../apps/catalog/catalog.module';
import { InventoryModule } from '../../apps/inventory/inventory.module';
import { OrderingModule } from '../../apps/ordering/ordering.module';
import { PaymentModule } from '../../apps/payment/payment.module';
import { CheckoutApiModule } from '../../apps/truoc/checkout-api';
import { EntityServiceModule, type EntityServiceName } from '../../apps/truoc/entity-services';
import { setLogSink, type LogEntry } from '../../libs/platform/log';
import { createServiceApp } from '../../libs/platform/service-app';

const url = (role: string, password = role) => `postgres://${role}:${password}@127.0.0.1:55432/lab`;

export const DATABASE_URLS = {
  admin: process.env.ADMIN_DATABASE_URL ?? url('postgres'),
  truoc: process.env.TRUOC_DATABASE_URL ?? url('truoc_app'),
  catalog: process.env.CATALOG_DATABASE_URL ?? url('catalog_app'),
  ordering: process.env.ORDERING_DATABASE_URL ?? url('ordering_app'),
  inventory: process.env.INVENTORY_DATABASE_URL ?? url('inventory_app'),
  payment: process.env.PAYMENT_DATABASE_URL ?? url('payment_app'),
};

const SEED_FILE = new URL('../../db/init/03-seed.sql', import.meta.url);

export function connectAdmin(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URLS.admin, max: 2 });
}

/** Đưa dữ liệu về trạng thái seed bằng chính file seed của lab. */
export async function resetData(admin: pg.Pool): Promise<void> {
  await admin.query(readFileSync(SEED_FILE, 'utf8'));
}

export const logs: LogEntry[] = [];
setLogSink((entry) => logs.push(entry));

interface RunningService {
  url: string;
  stop(): Promise<void>;
}

async function listen(name: string, module: DynamicModule): Promise<RunningService> {
  const app = await createServiceApp(name, module);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  let stopped = false;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      if (!stopped) {
        stopped = true;
        await app.close();
      }
    },
  };
}

export class Stack<Name extends string> {
  constructor(
    private readonly services: Record<Name, RunningService>,
    readonly entryUrl: string,
  ) {}

  urlOf(name: Name): string {
    return this.services[name].url;
  }

  stop(name: Name): Promise<void> {
    return this.services[name].stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all(Object.values<RunningService>(this.services).map((service) => service.stop()));
  }
}

export type SauStack = Stack<'catalog' | 'ordering' | 'inventory' | 'payment'>;
export type TruocStack = Stack<EntityServiceName | 'checkout-api'>;

export async function startSau(eventSchema: CatalogConfig['eventSchema'] = 'v1'): Promise<SauStack> {
  const inventory = await listen('inventory', InventoryModule.register(DATABASE_URLS.inventory));
  const payment = await listen('payment', PaymentModule.register(DATABASE_URLS.payment));
  const catalog = await listen('catalog', CatalogModule.register({ databaseUrl: DATABASE_URLS.catalog, eventSchema }));
  const ordering = await listen(
    'ordering',
    OrderingModule.register({
      databaseUrl: DATABASE_URLS.ordering,
      inventoryUrl: inventory.url,
      paymentUrl: payment.url,
      catalogEventPollMs: 20,
    }),
  );
  return new Stack({ catalog, ordering, inventory, payment }, ordering.url);
}

export async function startTruoc(): Promise<TruocStack> {
  const entity = (name: EntityServiceName) => listen(name, EntityServiceModule.register(name, DATABASE_URLS.truoc));
  const services = {
    'user-service': await entity('user-service'),
    'product-service': await entity('product-service'),
    'stock-service': await entity('stock-service'),
    'promotion-service': await entity('promotion-service'),
    'payment-service': await entity('payment-service'),
    'order-service': await entity('order-service'),
  };
  const checkout = await listen(
    'checkout-api',
    CheckoutApiModule.register({
      userUrl: services['user-service'].url,
      productUrl: services['product-service'].url,
      stockUrl: services['stock-service'].url,
      promotionUrl: services['promotion-service'].url,
      paymentUrl: services['payment-service'].url,
      orderUrl: services['order-service'].url,
    }),
  );
  return new Stack({ ...services, 'checkout-api': checkout }, checkout.url);
}

export const TWO_SKU_ORDER = {
  customerId: 'KH-0001',
  items: [
    { sku: 'SKU-0001', quantity: 1 },
    { sku: 'SKU-0002', quantity: 2 },
  ],
};
/** Theo seed: SKU-0001 giá 20.000, SKU-0002 giá 30.000. */
export const TWO_SKU_TOTAL_VND = 20_000 + 2 * 30_000;

export interface Reply {
  status: number;
  body: { orderId?: string; status?: string; totalVnd?: number };
}

export async function placeOrder(entryUrl: string, order: unknown, correlationId?: string): Promise<Reply> {
  const response = await fetch(`${entryUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
    body: JSON.stringify(order),
  });
  return { status: response.status, body: (await response.json()) as Reply['body'] };
}

export async function waitUntil(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
}

export async function snapshotPrice(admin: pg.Pool, sku: string): Promise<number | undefined> {
  const { rows } = await admin.query<{ unit_price_vnd: string }>(
    'SELECT unit_price_vnd FROM ordering.product_snapshots WHERE sku = $1',
    [sku],
  );
  return rows[0] ? Number(rows[0].unit_price_vnd) : undefined;
}

export async function sendCatalogEvent(admin: pg.Pool, event: unknown): Promise<void> {
  await admin.query("SELECT pgmq.send('catalog_events', $1::jsonb)", [JSON.stringify(event)]);
}

export async function changePrice(catalogUrl: string, sku: string, priceVnd: number): Promise<void> {
  const response = await fetch(`${catalogUrl}/products/${sku}/price`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ priceVnd }),
  });
  if (response.status !== 200) {
    throw new Error(`Đổi giá ${sku} trả ${response.status}`);
  }
}
