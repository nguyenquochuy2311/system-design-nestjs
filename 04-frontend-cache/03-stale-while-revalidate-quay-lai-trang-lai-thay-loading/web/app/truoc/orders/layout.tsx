import type { ReactNode } from 'react';
import { TruocHeader } from '../../../orders/truoc/header';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <TruocHeader />
      {children}
    </>
  );
}
