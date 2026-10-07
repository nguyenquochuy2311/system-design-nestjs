import type { ReactNode } from 'react';
import { CartBadge } from './cart-badge';
import './globals.css';

// icon "data:," để trình duyệt không xin /favicon.ico (404): mọi lượt xem có cùng một tập request để đo.
export const metadata = { title: 'Sàn TMĐT giả định — lab HTTP caching', icons: { icon: 'data:,' } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header className="top">
          <a href="/" className="logo">
            Sàn giả định
          </a>
          <CartBadge />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
