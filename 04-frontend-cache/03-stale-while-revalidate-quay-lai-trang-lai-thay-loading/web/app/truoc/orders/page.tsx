import { Suspense } from 'react';
import { TruocOrderList } from '../../../orders/truoc/order-list';
import { Spinner } from '../../../orders/ui';

// Trang dựng sẵn lúc build; bộ lọc đọc từ URL ở trình duyệt (useSearchParams cần Suspense).
export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <TruocOrderList />
    </Suspense>
  );
}
