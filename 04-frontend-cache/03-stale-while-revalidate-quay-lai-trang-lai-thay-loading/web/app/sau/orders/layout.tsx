import type { ReactNode } from 'react';
import { SauHeader } from '../../../orders/sau/header';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SauHeader />
      {children}
    </>
  );
}
