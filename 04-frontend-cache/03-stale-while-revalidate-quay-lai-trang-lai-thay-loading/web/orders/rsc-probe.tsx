'use client';
// Bộ đo cho route Server Component: ghi dữ liệu đang hiện như useListProbe của hai bản client.
import { filtersLabel, type OrderListResponse } from './contracts';
import { useListProbe } from './lab-probe';

export function RscProbe({ data }: { data: OrderListResponse }) {
  useListProbe({
    variant: 'rsc',
    key: filtersLabel(data.filters),
    dataKey: filtersLabel(data.filters),
    generatedAt: data.generatedAt,
    seq: data.seq,
    spinner: false,
    fetching: false,
    placeholder: false,
    error: false,
    rows: data.items.length,
  });
  return null;
}
