import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentClient } from '../src/shared/payment-client';

// Lỗi phổ biến nhất phía client: sinh khóa mới cho mỗi lần gửi lại. Server giả: lần đầu của mỗi khóa thì "mất response".
describe('client giả lập app di động', () => {
  const seen: string[] = [];
  let server: http.Server;
  let url = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const key = String(req.headers['idempotency-key']);
      const firstTime = !seen.includes(key);
      seen.push(key);
      req.resume();
      req.on('end', () => (firstTime ? req.socket.destroy() : res.writeHead(201).end('{"paymentId":"1"}')));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('giữ nguyên Idempotency-Key qua mọi lần gửi lại của một ý định, sinh khóa mới cho ý định mới', async () => {
    const client = new PaymentClient({ baseUrl: url, path: '/sau/payments', timeoutMs: 1_000, maxAttempts: 3, backoffMs: 1 });
    const intent = { userId: '1', merchantId: 7, amount: 1_000, note: 'x' };
    const first = await client.pay(intent);
    const second = await client.pay(intent);
    expect(first.status).toBe(201);
    expect(first.attempts).toHaveLength(2);
    expect(first.attempts[0]!.error).toBeDefined();
    expect(new Set(first.attempts.map((a) => a.key)).size).toBe(1);
    expect(second.attempts[0]!.key).not.toBe(first.attempts[0]!.key);
    expect(seen[0]).toBe(`"${first.attempts[0]!.key}"`);
  });
});
