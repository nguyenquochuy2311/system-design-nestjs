import type { ReactNode } from 'react';
import { Providers } from './providers';

// Provider đặt ở layout của /sau: layout không bị dựng lại khi điều hướng giữa danh sách và chi tiết, nên cache sống
// suốt phiên (tới khi tải lại trang).
export default function Layout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
