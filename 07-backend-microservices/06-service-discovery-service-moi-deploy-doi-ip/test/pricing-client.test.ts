import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingClient } from '../src/order/pricing-client';
import { buildPricing } from '../src/pricing/server';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('Client gọi pricing', () => {
  const servers: Server[] = [];
  let client: PricingClient | undefined;

  afterEach(async () => {
    await client?.close();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function fakePricing(pod: string, onRequest?: (socketId: number) => void) {
    let sockets = 0;
    const ids = new WeakMap<object, number>();
    const server = createServer((req, res) => {
      if (!ids.has(req.socket)) {
        sockets += 1;
        ids.set(req.socket, sockets);
      }
      onRequest?.(ids.get(req.socket) as number);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ pod, priceVnd: 1 }));
    });
    servers.push(server);
    return server;
  }

  it('giữ keep-alive mãi thì số kết nối không tăng theo số request', async () => {
    const seen = new Set<number>();
    const url = await listen(fakePricing('a', (socket) => seen.add(socket)));
    client = new PricingClient([url], { timeoutMs: 500, connectTimeoutMs: 300, maxConnectionAgeMs: 0, retries: 0 });

    for (let i = 0; i < 100; i += 1) {
      await client.quote(1);
    }

    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it('giới hạn tuổi kết nối buộc mở kết nối mới', async () => {
    const seen = new Set<number>();
    const url = await listen(fakePricing('a', (socket) => seen.add(socket)));
    client = new PricingClient([url], { timeoutMs: 500, connectTimeoutMs: 300, maxConnectionAgeMs: 20, retries: 0 });

    for (let i = 0; i < 10; i += 1) {
      await client.quote(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('danh sách IP thì chia vòng tròn: một IP chết là một phần request lỗi', async () => {
    const url = await listen(fakePricing('a'));
    client = new PricingClient([url, 'http://127.0.0.1:9'], { timeoutMs: 200, connectTimeoutMs: 300, maxConnectionAgeMs: 0, retries: 0 });

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => client?.quote(1)));

    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(5);
  });

  it('IP không còn ai trả lời thì hỏng sau connect timeout, không treo tới hạn mặc định', async () => {
    // 192.0.2.0/24 là dải dành cho tài liệu (RFC 5737): gói SYN đi mà không có phản hồi, giống IP của pod đã xóa.
    client = new PricingClient(['http://192.0.2.1:9'], { timeoutMs: 200, connectTimeoutMs: 300, maxConnectionAgeMs: 0, retries: 0 });
    const startedAt = performance.now();

    await expect(client.quote(1)).rejects.toThrow();

    // Đồng hồ của connect timeout trong undici thô, nên 300 ms thực tế là khoảng 1 giây; vẫn xa mặc định 10 giây.
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it('kết nối hỏng thì gửi lại một lần', async () => {
    const url = await listen(fakePricing('a'));
    client = new PricingClient(['http://127.0.0.1:9', url], { timeoutMs: 200, connectTimeoutMs: 300, maxConnectionAgeMs: 0, retries: 1 });

    await expect(client.quote(1)).resolves.toMatchObject({ pod: 'a' });
  });
});

describe('Probe của pricing', () => {
  it('đang khởi động thì sống nhưng chưa sẵn sàng', async () => {
    const app = buildPricing({ startupDelayMs: 200 });

    expect((await app.inject({ url: '/live' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/ready' })).statusCode).toBe(503);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await app.inject({ url: '/ready' })).statusCode).toBe(200);
    await app.close();
  });

  it('mất phụ thuộc thì không sẵn sàng nhưng vẫn sống, nên không bị khởi động lại', async () => {
    const app = buildPricing({ startupDelayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await app.inject({ method: 'POST', url: '/admin/ready?ok=false' });

    expect((await app.inject({ url: '/ready' })).statusCode).toBe(503);
    expect((await app.inject({ url: '/live' })).statusCode).toBe(200);
    await app.close();
  });
});
