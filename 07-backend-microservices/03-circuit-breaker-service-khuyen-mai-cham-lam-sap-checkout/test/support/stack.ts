import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { CheckoutModule, type CheckoutConfig } from '../../src/checkout/checkout.module';
import { setLogSink, type LogEntry } from '../../src/shared/log';
import { createServiceApp } from '../../src/shared/service-app';

export const logs: LogEntry[] = [];
setLogSink((entry) => logs.push(entry));

/** Promotion giả nghe cổng thật: đếm lời gọi tới nơi, và chậm hay lỗi theo lệnh của test. */
export class FakePromotion {
  requests = 0;
  delayMs = 0;
  status = 200;
  private readonly sockets = new Set<import('node:net').Socket>();

  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakePromotion> {
    const server = createServer();
    const fake = new FakePromotion(server);
    server.on('connection', (socket) => {
      fake.sockets.add(socket);
      socket.on('close', () => fake.sockets.delete(socket));
    });
    server.on('request', (req, res) => {
      req.resume();
      req.on('end', () => {
        fake.requests += 1;
        const { delayMs, status } = fake;
        setTimeout(() => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(status === 200 ? { discountVnd: 1_000 } : { message: 'Mã không hợp lệ' }));
        }, delayMs);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return fake;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => this.server.close(resolve));
  }
}

export const FAST_BREAKER = {
  timeoutMs: 100,
  errorThresholdPercentage: 50,
  volumeThreshold: 10,
  rollingCountTimeout: 10_000,
  resetTimeout: 300,
};

export class CheckoutApp {
  private constructor(
    private readonly app: INestApplication,
    readonly url: string,
  ) {}

  static async start(config: Omit<CheckoutConfig, 'poolSize'> & { poolSize?: number }): Promise<CheckoutApp> {
    const app = await createServiceApp('checkout', CheckoutModule.register({ poolSize: 50, ...config }));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    return new CheckoutApp(app, `http://127.0.0.1:${port}`);
  }

  async checkout(promoCode?: string): Promise<{ status: number; ms: number; body: Record<string, unknown> }> {
    const startedAt = performance.now();
    const response = await fetch(`${this.url}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cartId: 'C-1', subtotalVnd: 100_000, promoCode }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, ms: performance.now() - startedAt, body };
  }

  async metrics(): Promise<string> {
    return (await fetch(`${this.url}/metrics`)).text();
  }

  stop(): Promise<void> {
    return this.app.close();
  }
}

/** Gọi đủ số lời gọi hỏng để cầu dao mở. */
export async function tripBreaker(app: CheckoutApp, promotion: FakePromotion): Promise<void> {
  promotion.delayMs = 1_000;
  await Promise.all(Array.from({ length: FAST_BREAKER.volumeThreshold + 2 }, () => app.checkout()));
}

export const breakerStates = () => logs.filter((line) => line.event === 'circuit_state_changed').map((line) => line.state);

export { sleep };
