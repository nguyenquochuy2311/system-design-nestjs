'use client';
// Bản sau: dữ liệu server nằm trong cache của QueryClient theo khóa ['orders','list',bộ lọc]. Quay lại màn hình thì
// hiện ngay bản đang có; nếu đã quá staleTime thì làm mới ở nền và thay tại chỗ khi về.
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../api';
import { filtersLabel } from '../contracts';
import { useOrderFilters } from '../filters';
import { useListProbe } from '../lab-probe';
import { ErrorBox, FilterBar, Freshness, OrderTable, Pager, Spinner } from '../ui';
import { orderListQuery, warehousesQuery } from './order-queries';

export function SauOrderList() {
  const [filters, setFilters] = useOrderFilters();
  const list = useQuery(orderListQuery(filters));
  const warehouses = useQuery(warehousesQuery());
  const data = list.data;
  // [PATTERN] vòng xoay chỉ khi cache chưa có gì cho khóa này (lần đầu, hoặc đã quá gcTime).
  const spinner = data === undefined && list.isPending;

  useListProbe({
    variant: 'sau',
    key: filtersLabel(filters),
    dataKey: data ? filtersLabel(data.filters) : null,
    generatedAt: data?.generatedAt ?? null,
    seq: data?.seq ?? null,
    spinner,
    fetching: list.isFetching,
    placeholder: list.isPlaceholderData,
    error: list.isError,
    rows: data?.items.length ?? 0,
  });

  return (
    <main className="page">
      <FilterBar filters={filters} warehouses={warehouses.data ?? []} onChange={setFilters} />
      {spinner && <Spinner />}
      {!data && list.isError && <ErrorBox message={errorMessage(list.error)} onRetry={() => void list.refetch()} />}
      {data && (
        <>
          <div className="bar">
            {/* [PATTERN] hiện dữ liệu cũ thì luôn báo: "đang cập nhật" hoặc thời điểm của bản đang hiện. */}
            <Freshness generatedAt={data.generatedAt} fetching={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} />
          </div>
          <Pager page={filters.page} pageCount={data.pageCount} total={data.total} onChange={(page) => setFilters({ page })} />
          <OrderTable data={data} hrefBase="/sau/orders" dim={list.isPlaceholderData} />
        </>
      )}
    </main>
  );
}
