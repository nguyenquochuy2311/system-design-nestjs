import { Suspense } from 'react';
import { SauOrderDetail } from '../../../../orders/sau/order-detail';
import { Spinner } from '../../../../orders/ui';

// Suspense chỉ cần khi bật Cache Components (useParams phải nằm trong ranh giới Suspense lúc prerender); ở chế độ
// mặc định không đổi gì.
export default function Page() {
  return (
    <Suspense fallback={<Spinner label="Đang tải đơn…" />}>
      <SauOrderDetail />
    </Suspense>
  );
}
