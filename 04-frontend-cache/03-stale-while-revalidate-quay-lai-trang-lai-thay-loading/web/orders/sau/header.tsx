'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { logout } from '../api';
import { meQuery } from './order-queries';

export function SauHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery());
  return (
    <header className="top">
      <strong>Danh sách đơn · bản sau</strong>
      <span data-testid="me">{me.data ? `${me.data.name} · ${me.data.regionName}` : '…'}</span>
      <button
        type="button"
        data-testid="logout"
        onClick={() =>
          void logout().then(() => {
            // [PATTERN] máy dùng chung: xóa toàn bộ cache (danh sách, chi tiết đơn có tên, số điện thoại khách) trước khi
            // sang trang đăng nhập, để người dùng sau không thấy dữ liệu của người trước.
            queryClient.clear();
            router.replace('/sau/login');
          })
        }
      >
        Đăng xuất
      </button>
    </header>
  );
}
