import type { FastifyInstance } from 'fastify';
import type { CursorPageResponse } from '../../src/app.js';
import type { OffsetPage } from '../../src/truoc/transactions-offset.repository.js';

/** Lật trang theo cursor tới khi nextCursor null; `afterPage` chạy sau mỗi trang (ví dụ chèn giao dịch mới). */
export async function flipByCursor(app: FastifyInstance, merchantId: number, limit: number, afterPage?: (pageNo: number) => Promise<void>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const qs: string = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) }).toString();
    const res = await app.inject({ method: 'GET', url: `/merchants/${merchantId}/transactions?${qs}` });
    if (res.statusCode !== 200) throw new Error(`trang ${pages + 1}: ${res.statusCode} ${res.body}`);
    const body = res.json<CursorPageResponse>();
    ids.push(...body.items.map((t) => t.id));
    cursor = body.nextCursor;
    pages += 1;
    await afterPage?.(pages);
  } while (cursor);
  return { ids, pages };
}

/** Lật `pages` trang theo page= (bản trước). */
export async function flipByPage(app: FastifyInstance, merchantId: number, size: number, pages: number, afterPage?: (pageNo: number) => Promise<void>) {
  const ids: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await app.inject({ method: 'GET', url: `/merchants/${merchantId}/transactions?page=${page}&size=${size}` });
    if (res.statusCode !== 200) throw new Error(`trang ${page}: ${res.statusCode} ${res.body}`);
    ids.push(...res.json<OffsetPage>().items.map((t) => t.id));
    await afterPage?.(page);
  }
  return ids;
}
