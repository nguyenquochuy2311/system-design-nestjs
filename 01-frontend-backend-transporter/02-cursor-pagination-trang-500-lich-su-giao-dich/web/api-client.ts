import type { CursorPageResponse } from '../src/app.js';

export type { CursorPageResponse };

/** Lấy một trang theo cursor; null là trang đầu. */
export type FetchTransactionsPage = (merchantId: number, cursor: string | null) => Promise<CursorPageResponse>;

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createApiClient(baseUrl: string, fetchImpl: FetchLike = fetch): FetchTransactionsPage {
  return async (merchantId, cursor) => {
    const params = new URLSearchParams({ limit: '20' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetchImpl(`${baseUrl}/merchants/${merchantId}/transactions?${params}`);
    if (!res.ok) throw new Error(`GET lịch sử giao dịch trả ${res.status}`);
    return (await res.json()) as CursorPageResponse;
  };
}
