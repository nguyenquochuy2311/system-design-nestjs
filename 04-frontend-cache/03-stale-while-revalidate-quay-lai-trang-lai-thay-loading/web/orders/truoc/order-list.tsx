'use client';
// HIỆN TRẠNG: dữ liệu server là state của component. Mount (quay lại từ chi tiết) hay đổi bộ lọc là xóa trắng, quay
// vòng, tải lại từ đầu; component unmount là mất dữ liệu. Không có khái niệm "còn dùng được nhưng nên làm mới".
import { useEffect, useState } from 'react';
import { errorMessage, fetchOrders, fetchWarehouses } from '../api';
import { filtersLabel, type OrderListResponse, type Warehouse } from '../contracts';
import { useOrderFilters } from '../filters';
import { useListProbe } from '../lab-probe';
import { ErrorBox, FilterBar, OrderTable, Pager, Spinner } from '../ui';

type State = { status: 'loading' } | { status: 'success'; data: OrderListResponse } | { status: 'error'; message: string };

export function TruocOrderList() {
  const [filters, setFilters] = useOrderFilters();
  const key = filtersLabel(filters);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    fetchOrders(filters, ctrl.signal).then(
      (data) => setState({ status: 'success', data }),
      (err) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: errorMessage(err) });
      },
    );
    return () => ctrl.abort();
    // filters suy ra từ key; chạy lại khi bộ lọc đổi hoặc bấm "Thử lại".
  }, [key, attempt]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchWarehouses(ctrl.signal).then(setWarehouses, () => undefined);
    return () => ctrl.abort();
  }, []);

  const data = state.status === 'success' ? state.data : null;
  useListProbe({
    variant: 'truoc',
    key,
    dataKey: data ? filtersLabel(data.filters) : null,
    generatedAt: data?.generatedAt ?? null,
    seq: data?.seq ?? null,
    spinner: state.status === 'loading',
    fetching: state.status === 'loading',
    placeholder: false,
    error: state.status === 'error',
    rows: data?.items.length ?? 0,
  });

  return (
    <main className="page">
      <FilterBar filters={filters} warehouses={warehouses} onChange={setFilters} />
      {state.status === 'loading' && <Spinner />}
      {state.status === 'error' && <ErrorBox message={state.message} onRetry={() => setAttempt((n) => n + 1)} />}
      {data && (
        <>
          <Pager page={filters.page} pageCount={data.pageCount} total={data.total} onChange={(page) => setFilters({ page })} />
          <OrderTable data={data} hrefBase="/truoc/orders" />
        </>
      )}
    </main>
  );
}
