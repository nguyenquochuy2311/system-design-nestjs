import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';
import type { FetchTransactionsPage } from './api-client.js';

/**
 * [PATTERN] Phía frontend, "trang sau" là một tham số mờ do server trả về: không tự tính số trang,
 * không giữ tổng số trang. Trang đầu có pageParam null; hết dữ liệu khi nextCursor null.
 */
export function transactionHistoryQuery(merchantId: number, fetchPage: FetchTransactionsPage) {
  return infiniteQueryOptions({
    queryKey: ['transactions', merchantId],
    queryFn: ({ pageParam }) => fetchPage(merchantId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

const vnd = new Intl.NumberFormat('vi-VN');

export function TransactionHistory({ merchantId, fetchPage }: { merchantId: number; fetchPage: FetchTransactionsPage }) {
  const query = useInfiniteQuery(transactionHistoryQuery(merchantId, fetchPage));

  if (query.isPending) return <p>Đang tải lịch sử giao dịch…</p>;
  if (query.isError) return <p role="alert">Không tải được lịch sử giao dịch.</p>;

  const rows = query.data.pages.flatMap((page) => page.items);
  return (
    <section>
      <h1>Lịch sử giao dịch</h1>
      <ol>
        {rows.map((t) => (
          <li key={t.id} data-id={t.id}>
            {t.createdAt} · {t.description} · {vnd.format(t.amount)} ₫
          </li>
        ))}
      </ol>
      {query.hasNextPage ? (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
        </button>
      ) : (
        <p>Đã hết giao dịch.</p>
      )}
    </section>
  );
}
