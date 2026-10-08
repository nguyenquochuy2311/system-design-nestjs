'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { lab } from '../../orders/lab-probe';
import { makeQueryClient } from '../../orders/sau/order-queries';

export function Providers({ children }: { children: ReactNode }) {
  // [PATTERN] một QueryClient (một cache) cho cả phiên, tạo đúng một lần: useState giữ nó qua các lần render.
  const [queryClient] = useState(() => makeQueryClient());
  useEffect(() => {
    // Bộ đo cho test và script đo: đếm truy vấn trong cache (kiểm "đăng xuất xóa sạch").
    const l = lab();
    if (!l) return;
    l.queryCount = () => queryClient.getQueryCache().getAll().length;
    l.queryKeys = () => queryClient.getQueryCache().getAll().map((q) => q.queryKey);
  }, [queryClient]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
