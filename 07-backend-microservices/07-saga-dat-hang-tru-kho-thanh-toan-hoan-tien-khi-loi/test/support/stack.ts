import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { FakeGateway } from '../../apps/fake-gateway/fake-gateway';
import { InventoryServiceModule } from '../../apps/inventory-service/inventory-service.module';
import { OrderServiceModule } from '../../apps/order-service/order-service.module';
import { PaymentServiceModule } from '../../apps/payment-service/payment-service.module';
import { TruocModule } from '../../apps/truoc/truoc.module';
import { setLogSink } from '../../libs/platform/log';
import { createServiceApp } from '../../libs/platform/service-app';
import { reconcile } from '../../libs/reconcile';

setLogSink(() => undefined);

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;

export const DATABASE_URLS = {
  admin: process.env.ADMIN_DATABASE_URL ?? url('postgres'),
  order: process.env.ORDER_DATABASE_URL ?? url('order_rw'),
  inventory: process.env.INVENTORY_DATABASE_URL ?? url('inventory_rw'),
  payment: process.env.PAYMENT_DATABASE_URL ?? url('payment_rw'),
  truoc: process.env.TRUOC_DATABASE_URL ?? url('truoc_rw'),
};

const GATEWAY_TIMEOUT_MS = 100;

export const connectAdmin = () => new pg.Pool({ connectionString: DATABASE_URLS.admin, max: 3 });

export async function resetData(admin: pg.Pool): Promise<void> {
  await admin.query(readFileSync(new URL('../../db/init/03-seed.sql', import.meta.url), 'utf8'));
}

async function listen(name: string, module: DynamicModule): Promise<{ app: INestApplication; url: string }> {
  const app = await createServiceApp(name, module);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

export const NEW_ORDER = { sku: 'SKU-0001', quantity: 2, amountVnd: 300_000 };

export class SagaStack {
  readonly gateway = new FakeGateway();
  private gatewayApp!: FastifyInstance;
  gatewayUrl = '';
  orderUrl = '';
  private order: INestApplication | undefined;
  private inventory: INestApplication | undefined;
  private payment: INestApplication | undefined;

  constructor(private readonly deadlineSeconds = 900) {}

  async startGateway(): Promise<void> {
    this.gateway.behavior.latencyMs = 1;
    this.gateway.behavior.stallMs = 300;
    this.gatewayApp = this.gateway.build();
    this.gatewayUrl = await this.gatewayApp.listen({ port: 0, host: '127.0.0.1' });
  }

  async startOrder(): Promise<void> {
    const { app, url: orderUrl } = await listen(
      'order-service',
      OrderServiceModule.register({ databaseUrl: DATABASE_URLS.order, deadlineSeconds: this.deadlineSeconds, pollMs: 10 }),
    );
    this.order = app;
    this.orderUrl = orderUrl;
  }

  async startInventory(): Promise<void> {
    this.inventory = (await listen('inventory-service', InventoryServiceModule.register(DATABASE_URLS.inventory, 10))).app;
  }

  async startPayment(): Promise<void> {
    this.payment = (
      await listen(
        'payment-service',
        PaymentServiceModule.register({
          databaseUrl: DATABASE_URLS.payment,
          gatewayUrl: this.gatewayUrl,
          gatewayTimeoutMs: GATEWAY_TIMEOUT_MS,
          pollMs: 10,
          visibilitySeconds: 1,
        }),
      )
    ).app;
  }

  async startAll(): Promise<this> {
    await this.startGateway();
    await this.startInventory();
    await this.startPayment();
    await this.startOrder();
    return this;
  }

  async stopOrder(): Promise<void> {
    await this.order?.close();
    this.order = undefined;
  }

  async stopInventory(): Promise<void> {
    await this.inventory?.close();
    this.inventory = undefined;
  }

  async stopPayment(): Promise<void> {
    await this.payment?.close();
    this.payment = undefined;
  }

  async stopAll(): Promise<void> {
    await this.stopOrder();
    await this.stopPayment();
    await this.stopInventory();
    await this.gatewayApp.close();
  }

  async place(order: unknown = NEW_ORDER): Promise<string> {
    const response = await fetch(`${this.orderUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (response.status !== 202) {
      throw new Error(`POST /orders trả ${response.status}`);
    }
    return ((await response.json()) as { orderId: string }).orderId;
  }

  async view(orderId: string) {
    const response = await fetch(`${this.orderUrl}/orders/${orderId}`);
    return (await response.json()) as { status: string; state: string; history: { to_state: string; event: string }[] };
  }

  report(admin: pg.Pool) {
    return reconcile(admin, this.gatewayUrl, 'sau');
  }
}

export class TruocStack {
  readonly gateway = new FakeGateway();
  private readonly apps: INestApplication[] = [];
  private gatewayApp!: FastifyInstance;
  gatewayUrl = '';
  orderUrl = '';
  private inventory: INestApplication | undefined;

  async start(): Promise<this> {
    this.gateway.behavior.latencyMs = 1;
    this.gateway.behavior.stallMs = 300;
    this.gatewayApp = this.gateway.build();
    this.gatewayUrl = await this.gatewayApp.listen({ port: 0, host: '127.0.0.1' });
    const inventory = await listen('truoc-inventory', TruocModule.inventory(DATABASE_URLS.truoc));
    const payment = await listen('truoc-payment', TruocModule.payment(this.gatewayUrl, GATEWAY_TIMEOUT_MS));
    const order = await listen(
      'truoc-order',
      TruocModule.order(DATABASE_URLS.truoc, { inventoryUrl: inventory.url, paymentUrl: payment.url }),
    );
    this.inventory = inventory.app;
    this.apps.push(payment.app, order.app);
    this.orderUrl = order.url;
    return this;
  }

  async stopInventory(): Promise<void> {
    await this.inventory?.close();
    this.inventory = undefined;
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.apps.map((app) => app.close()));
    await this.stopInventory();
    await this.gatewayApp.close();
  }

  async place(order: unknown = NEW_ORDER): Promise<number> {
    const response = await fetch(`${this.orderUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    return response.status;
  }

  report(admin: pg.Pool) {
    return reconcile(admin, this.gatewayUrl, 'truoc');
  }
}

export async function waitUntil(condition: () => Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
}

export async function reservedOf(admin: pg.Pool, sku = NEW_ORDER.sku): Promise<number> {
  const { rows } = await admin.query<{ reserved: number }>('SELECT reserved FROM inventory.stock_items WHERE sku = $1', [sku]);
  return rows[0]?.reserved ?? -1;
}

export async function sendCommand(admin: pg.Pool, queue: string, message: unknown): Promise<void> {
  await admin.query('SELECT pgmq.send($1, $2::jsonb)', [queue, JSON.stringify(message)]);
}
