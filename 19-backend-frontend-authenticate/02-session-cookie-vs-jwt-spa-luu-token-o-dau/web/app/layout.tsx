import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Lab 19/02 — Session vs JWT' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
