import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { FakeBank } from '../../src/fake-bank/fake-bank';
import { setLogSink } from '../../src/shared/log';
import { createServiceApp } from '../../src/shared/service-app';
import { WalletModule, type WalletConfig } from '../../src/wallet/wallet.module';

setLogSink(() => undefined);

export const FAST_RETRY = {
  attemptTimeoutMs: 150,
  totalTimeoutMs: 800,
  connectTimeoutMs: 100,
  maxRetries: 3,
  baseDelayMs: 20,
  maxDelayMs: 100,
};

export class Lab {
  private constructor(
    readonly bank: FakeBank,
    private readonly bankApp: FastifyInstance,
    private readonly wallet: INestApplication,
    readonly url: string,
  ) {}

  static async start(config: Omit<WalletConfig, 'bankUrl'>): Promise<Lab> {
    const bank = new FakeBank();
    const bankApp = bank.build();
    const bankUrl = await bankApp.listen({ port: 0, host: '127.0.0.1' });
    const wallet = await createServiceApp('wallet', WalletModule.register({ retry: FAST_RETRY, ...config, bankUrl }));
    await wallet.listen(0, '127.0.0.1');
    const { port } = wallet.getHttpServer().address() as AddressInfo;
    return new Lab(bank, bankApp, wallet, `http://127.0.0.1:${port}`);
  }

  async topUp(amountVnd = 500_000): Promise<{ status: number; ms: number; body: Record<string, unknown> }> {
    const startedAt = performance.now();
    const response = await fetch(`${this.url}/topups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountVnd }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, ms: performance.now() - startedAt, body };
  }

  async statusOf(topupId: unknown): Promise<unknown> {
    const response = await fetch(`${this.url}/topups/${String(topupId)}`);
    return ((await response.json()) as { status: unknown }).status;
  }

  async metrics(): Promise<string> {
    return (await fetch(`${this.url}/metrics`)).text();
  }

  /** Số lần đối tác nhận lệnh nạp của lệnh duy nhất đã gửi. */
  attempts(): number {
    return [...this.bank.attemptsByReference.values()].reduce((sum, times) => sum + times.length, 0);
  }

  async stop(): Promise<void> {
    await this.wallet.close();
    await this.bankApp.close();
  }
}

export async function waitUntil(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
}
