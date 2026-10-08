'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, assignOrder, errorMessage, fetchOrder } from '../api';
import type { Order } from '../contracts';
import { labEvent } from '../lab-probe';
import { Spinner, OrderDetailView } from '../ui';

export function TruocOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchOrder(id, ctrl.signal).then(setOrder, (e) => {
      if (!ctrl.signal.aborted) setMessage(errorMessage(e));
    });
    return () => ctrl.abort();
  }, [id]);

  if (!order) return message ? <p className="error-box">{message}</p> : <Spinner label="Đang tải đơn…" />;
  return (
    <main className="page">
      <OrderDetailView
        order={order}
        assigning={assigning}
        message={message}
        onBack={() => router.back()}
        onAssign={(shipper) => {
          setAssigning(true);
          assignOrder(id, shipper)
            .then((r) => {
              setOrder(r.order);
              setMessage(`Đã phân cho ${shipper}`);
              labEvent({ type: 'assigned', variant: 'truoc', orderId: id, seq: r.seq, at: r.order.updatedAt });
            })
            .catch((e: unknown) => {
              setMessage(errorMessage(e));
              labEvent({ type: 'assign-error', variant: 'truoc', orderId: id, status: e instanceof ApiError ? e.status : 0 });
            })
            .finally(() => setAssigning(false));
        }}
      />
    </main>
  );
}
