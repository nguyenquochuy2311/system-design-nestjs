'use client';

import { useEffect, useState } from 'react';
import type { CartSummaryJson } from '../../src/shared/catalog-data';

// Giỏ hàng là dữ liệu riêng: gọi /api/cart/summary kèm cookie phiên. Trang HTML vẫn giống nhau cho mọi khách.
export function CartBadge() {
  const [summary, setSummary] = useState<CartSummaryJson | null | 'guest'>(null);
  useEffect(() => {
    fetch('/api/cart/summary')
      // Đọc hết body cả khi 401: body chưa đọc thì request còn treo, trình duyệt (và phép đo) không thấy trang tải xong.
      .then(async (r) => {
        const text = await r.text();
        setSummary(r.ok ? (JSON.parse(text) as CartSummaryJson) : 'guest');
      })
      .catch(() => setSummary('guest'));
  }, []);
  if (summary === null) return <span className="cart">Giỏ hàng</span>;
  if (summary === 'guest') return <span className="cart">Đăng nhập</span>;
  return (
    <span className="cart" data-user={summary.userId}>
      Giỏ hàng ({summary.count}) · {summary.total.toLocaleString('vi-VN')} ₫
    </span>
  );
}
