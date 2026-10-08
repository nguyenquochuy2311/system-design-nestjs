'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Me } from '../contracts';
import { fetchMe, logout } from '../api';

export function TruocHeader() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchMe(ctrl.signal).then(setMe, () => undefined);
    return () => ctrl.abort();
  }, []);
  return (
    <header className="top">
      <strong>Danh sách đơn · bản trước</strong>
      <span data-testid="me">{me ? `${me.name} · ${me.regionName}` : '…'}</span>
      <button type="button" data-testid="logout" onClick={() => void logout().then(() => router.replace('/truoc/login'))}>
        Đăng xuất
      </button>
    </header>
  );
}
