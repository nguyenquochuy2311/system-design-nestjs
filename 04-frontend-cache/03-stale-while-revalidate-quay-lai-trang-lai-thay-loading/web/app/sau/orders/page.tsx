import { Suspense } from 'react';
import { SauOrderList } from '../../../orders/sau/order-list';
import { Spinner } from '../../../orders/ui';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <SauOrderList />
    </Suspense>
  );
}
