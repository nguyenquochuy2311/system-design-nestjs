'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, assignOrder, errorMessage } from '../api';
import { labEvent } from '../lab-probe';
import { OrderDetailView, Spinner } from '../ui';
import { orderDetailQuery, orderKeys } from './order-queries';

export function SauOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const order = useQuery(orderDetailQuery(id));
  const assign = useMutation({
    mutationFn: (shipper: string) => assignOrder(id, shipper),
    onSuccess: async (r) => {
      queryClient.setQueryData(orderKeys.detail(id), r.order);
      labEvent({ type: 'assigned', variant: 'sau', orderId: id, seq: r.seq, at: r.order.updatedAt });
      // [PATTERN] phân đơn xong thì mọi danh sách đơn (mọi bộ lọc, mọi trang) thành cũ. Danh sách đang hiện thì tải lại
      // ngay; danh sách không hiện (ta đang ở màn chi tiết) tải lại ở lần hiện tới, trong lúc đó vẫn hiện bản cũ kèm
      // "Đang cập nhật".
      await queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
    onError: (e) => {
      labEvent({ type: 'assign-error', variant: 'sau', orderId: id, status: e instanceof ApiError ? e.status : 0 });
      // 409: người khác đã nhận đơn trong lúc ta xem bản cũ; lấy lại chi tiết để thấy ai đã nhận.
      if (e instanceof ApiError && e.status === 409) void queryClient.invalidateQueries({ queryKey: orderKeys.detail(id) });
    },
  });

  if (!order.data) return order.isError ? <p className="error-box">{errorMessage(order.error)}</p> : <Spinner label="Đang tải đơn…" />;
  return (
    <main className="page">
      <OrderDetailView
        order={order.data}
        assigning={assign.isPending}
        message={assign.isSuccess ? `Đã phân cho ${assign.variables}` : assign.isError ? errorMessage(assign.error) : null}
        onBack={() => router.back()}
        onAssign={(shipper) => assign.mutate(shipper)}
      />
    </main>
  );
}
