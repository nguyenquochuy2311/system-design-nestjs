import { cookies } from 'next/headers';
import Link from 'next/link';
import type { Order } from '../../../../orders/contracts';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`http://127.0.0.1:3100/api/orders/${encodeURIComponent(id)}`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  if (!res.ok) return <p className="error-box">API trả {res.status}</p>;
  const order = (await res.json()) as Order;
  return (
    <main className="page">
      <div className="detail" data-testid="order-detail" data-id={order.id} data-status={order.status}>
        <h2>{order.code}</h2>
        <p>
          {order.customer} · {order.address}
        </p>
        {/* Điều hướng TIẾN tới danh sách (khác nút Back của trình duyệt). */}
        <Link href="/rsc/orders?status=moi&warehouse=tat-ca&page=1" prefetch={false} data-testid="rsc-forward-list">
          Về danh sách (liên kết)
        </Link>
      </div>
    </main>
  );
}
