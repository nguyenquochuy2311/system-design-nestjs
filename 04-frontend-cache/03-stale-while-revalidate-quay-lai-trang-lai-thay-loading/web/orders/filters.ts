'use client';
// Bộ lọc nằm trên URL (?status=&warehouse=&page=) để nút Back trả về đúng bộ lọc. Đổi bộ lọc bằng History API gốc:
// Next.js (từ 14.1) đồng bộ useSearchParams mà không gọi server và không unmount danh sách. Dùng chung cho hai bản.
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { filtersToQuery, parseFilters, type OrderFilters } from './contracts';

export function useOrderFilters(): [OrderFilters, (patch: Partial<OrderFilters>) => void] {
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters((name) => params.get(name)), [params]);
  const setFilters = useCallback(
    (patch: Partial<OrderFilters>) => {
      const changedFilter = (patch.status !== undefined && patch.status !== filters.status) || (patch.warehouse !== undefined && patch.warehouse !== filters.warehouse);
      // Đổi trạng thái hay kho thì về trang 1.
      const next: OrderFilters = { ...filters, ...patch, page: patch.page ?? (changedFilter ? 1 : filters.page) };
      window.history.pushState(null, '', `?${filtersToQuery(next)}`);
    },
    [filters],
  );
  return [filters, setFilters];
}
