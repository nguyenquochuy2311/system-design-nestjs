import type { AddressInfo } from 'node:net';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import { BffModule } from '../../apps/bff/bff.module';
import { ProviderModule, type ProviderBehavior, type ProviderName } from '../../apps/providers/providers.module';
import type { ProviderUrls } from '../../apps/truoc/legacy-client';
import { setLogSink, type LogEntry } from '../../libs/platform/log';
import { createServiceApp } from '../../libs/platform/service-app';

export const logs: LogEntry[] = [];
setLogSink((entry) => logs.push(entry));

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;

const DATABASES: Record<ProviderName, string> = {
  'order-service': process.env.ORDER_DATABASE_URL ?? url('order_rw'),
  'payment-service': process.env.PAYMENT_DATABASE_URL ?? url('payment_rw'),
  'shipping-service': process.env.SHIPPING_DATABASE_URL ?? url('shipping_rw'),
  'customer-service': process.env.CUSTOMER_DATABASE_URL ?? url('customer_rw'),
};

async function listen(name: string, module: DynamicModule): Promise<{ app: INestApplication; url: string }> {
  const app = await createServiceApp(name, module);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

export class Stack {
  readonly behaviors = {
    order: { delayMs: 0, failing: false, requests: 0 } as ProviderBehavior,
    payment: { delayMs: 0, failing: false, requests: 0 } as ProviderBehavior,
    shipping: { delayMs: 0, failing: false, requests: 0 } as ProviderBehavior,
    customer: { delayMs: 0, failing: false, requests: 0 } as ProviderBehavior,
  };
  private apps: INestApplication[] = [];
  urls!: ProviderUrls;
  bffUrl = '';

  async start(): Promise<this> {
    const provider = async (name: ProviderName, behavior: ProviderBehavior) => {
      const { app, url: providerUrl } = await listen(name, ProviderModule.register(name, DATABASES[name], behavior));
      this.apps.push(app);
      return providerUrl;
    };
    this.urls = {
      orderUrl: await provider('order-service', this.behaviors.order),
      paymentUrl: await provider('payment-service', this.behaviors.payment),
      shippingUrl: await provider('shipping-service', this.behaviors.shipping),
      customerUrl: await provider('customer-service', this.behaviors.customer),
    };
    const bff = await listen('bff', BffModule.register(this.urls));
    this.apps.push(bff.app);
    this.bffUrl = bff.url;
    return this;
  }

  async stop(): Promise<void> {
    await Promise.all(this.apps.map((app) => app.close()));
  }

  requestsTotal(): number {
    return Object.values(this.behaviors).reduce((sum, behavior) => sum + behavior.requests, 0);
  }

  async detail(orderId: string, userId = 'KH-1', role = 'customer') {
    const startedAt = performance.now();
    const response = await fetch(`${this.bffUrl}/order-details/${orderId}`, {
      headers: { 'x-user-id': userId, 'x-user-role': role },
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, ms: performance.now() - startedAt, body };
  }

  async list(customerId: string, userId = customerId, role = 'customer') {
    const response = await fetch(`${this.bffUrl}/order-details?customerId=${customerId}`, {
      headers: { 'x-user-id': userId, 'x-user-role': role },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown>[] };
  }
}

/** Theo seed: DH-1 thuộc KH-1, DH-2 thuộc KH-2. */
export const ORDER_OF_KH1 = 'DH-1';
export const ORDER_OF_KH2 = 'DH-2';
