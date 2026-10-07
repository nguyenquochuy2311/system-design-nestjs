'use client';

import { useEffect, useState } from 'react';
import type { ProductJson } from '../../src/shared/catalog-data';

// Ảnh dùng <img> thường trỏ thẳng /media/... (media-service quyết định header), không qua next/image, và không
// loading="lazy": mọi lượt xem tải cùng một tập request, nên k6 và Chrome so được với nhau (README mục 5.1).
export function CatalogGrid({ category }: { category: string }) {
  const [products, setProducts] = useState<ProductJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/products?category=${encodeURIComponent(category)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProductJson[]>;
      })
      .then(setProducts)
      .catch((e: unknown) => setError(String(e)));
  }, [category]);
  if (error) return <p role="alert">Không tải được danh sách: {error}</p>;
  if (!products) return <p>Đang tải…</p>;
  return (
    <div className="grid" data-count={products.length}>
      {products.map((p) => (
        <a key={p.id} className="card" href={`/san-pham/${p.id}`}>
          <img src={p.images.thumb} alt={p.name} width={480} height={480} />
          <div className="info">
            <div>{p.name}</div>
            <div className="price">{p.price.toLocaleString('vi-VN')} ₫</div>
          </div>
        </a>
      ))}
    </div>
  );
}
