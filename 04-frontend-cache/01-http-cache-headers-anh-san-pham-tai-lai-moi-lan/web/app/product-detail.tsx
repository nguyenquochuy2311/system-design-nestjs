'use client';

import { useEffect, useState } from 'react';
import type { ProductJson } from '../../src/shared/catalog-data';

export function ProductDetail({ id }: { id: number }) {
  const [product, setProduct] = useState<ProductJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProductJson>;
      })
      .then(setProduct)
      .catch((e: unknown) => setError(String(e)));
  }, [id]);
  if (error) return <p role="alert">Không tải được sản phẩm: {error}</p>;
  if (!product) return <p>Đang tải…</p>;
  return (
    <div className="detail">
      <img src={product.images.large} alt={product.name} width={1200} height={1200} />
      <div>
        <h1>{product.name}</h1>
        <div className="price" data-price={product.price}>
          {product.price.toLocaleString('vi-VN')} ₫
        </div>
      </div>
    </div>
  );
}
