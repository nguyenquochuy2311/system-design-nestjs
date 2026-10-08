// Chỉ để kiểm cache router phía client của Next.js (bench/router-cache-check.ts), không phải bản "sau": danh sách là
// Server Component, đọc API lúc request (no-store) rồi gửi RSC payload về trình duyệt.
import { cookies } from 'next/headers';
import Link from 'next/link';
import { filtersToQuery, parseFilters, type OrderListResponse } from '../../../orders/contracts';
import { RscProbe } from '../../../orders/rsc-probe';
import { OrderTable } from '../../../orders/ui';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filters = parseFilters((name) => (typeof sp[name] === 'string' ? (sp[name] as string) : null));
  const res = await fetch(`http://127.0.0.1:3100/api/orders?${filtersToQuery(filters)}`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  if (!res.ok) return <p className="error-box">API trả {res.status}</p>;
  const data = (await res.json()) as OrderListResponse;
  return (
    <main className="page">
      <p className="bar">
        <span className="fresh" data-testid="list-updated-at">
          Dựng ở server lúc {new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour12: false })}
        </span>
        <Link href="/rsc/orders?status=tat-ca&warehouse=tat-ca&page=1" prefetch={false} data-testid="rsc-other-filter">
          Xem tất cả trạng thái
        </Link>
      </p>
      <RscProbe data={data} />
      <OrderTable data={data} hrefBase="/rsc/orders" />
    </main>
  );
}
