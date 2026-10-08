import type { ReactNode } from 'react';
import './globals.css';

// icon "data:," để trình duyệt không xin /favicon.ico (404): mọi lượt xem có cùng tập request.
export const metadata = { title: 'Điều phối giao hàng — lab stale-while-revalidate', icons: { icon: 'data:,' } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
