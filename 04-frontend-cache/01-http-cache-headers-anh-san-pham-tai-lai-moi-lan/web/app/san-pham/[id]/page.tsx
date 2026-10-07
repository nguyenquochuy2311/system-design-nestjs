import { productIds } from '../../../../src/shared/catalog-data';
import { ProductDetail } from '../../product-detail';

export const dynamicParams = false;
export function generateStaticParams() {
  return productIds().map((id) => ({ id: String(id) }));
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetail id={Number(id)} />;
}
