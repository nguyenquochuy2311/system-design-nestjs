// @vitest-environment happy-dom
/**
 * Frontend: màn hình "Lịch sử giao dịch" dùng useInfiniteQuery, bấm "Xem thêm" tới hết danh sách.
 * Request đi qua Fastify `inject` (đủ routing, kiểm cursor, serialize) thay cho mạng, để fetch của happy-dom
 * không chặn theo same-origin.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/shared/db.js';
import { createApiClient } from '../web/api-client.js';
import { TransactionHistory } from '../web/transaction-history.js';
import { duplicates, idsInDisplayOrder, insertNewTransactions, seedHistory, setupTestDb, testApp } from './support/test-db.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let db: Kysely<Database>;
let app: FastifyInstance;
const requested: string[] = [];

beforeAll(async () => {
  db = await setupTestDb();
  app = testApp(db);
  await seedHistory(db, 1, 95);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const injectFetch = async (url: string) => {
  requested.push(url);
  const res = await app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search });
  return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() as unknown };
};

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(check()).toBe(true);
}

describe('TransactionHistory (useInfiniteQuery)', () => {
  it('bấm "Xem thêm" tới hết: hiện đủ 95 giao dịch đúng thứ tự, không trùng, dù có giao dịch mới chen vào giữa chừng', async () => {
    const expected = await idsInDisplayOrder(db, 1);
    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TransactionHistory merchantId={1} fetchPage={createApiClient('http://api.test', injectFetch)} />
        </QueryClientProvider>,
      );
    });

    const shown = () => [...container.querySelectorAll('li')].map((li) => li.getAttribute('data-id')!);
    const button = () => [...container.querySelectorAll('button')].find((b) => !b.disabled);
    await waitFor(() => shown().length === 20);

    for (let clicks = 1; clicks <= 4; clicks++) {
      await insertNewTransactions(db, 1, 3); // giao dịch mới vào đầu danh sách trong lúc kế toán đang xem
      await act(async () => button()!.click());
      await waitFor(() => shown().length === Math.min(95, 20 * (clicks + 1)));
    }

    expect(container.textContent).toContain('Đã hết giao dịch.');
    expect(duplicates(shown())).toEqual([]);
    expect(shown()).toEqual(expected);
    expect(requested).toHaveLength(5);
    expect(requested[0]).not.toContain('cursor=');
    expect(requested.slice(1).every((u) => u.includes('cursor='))).toBe(true);
    await act(async () => root.unmount());
  });
});
