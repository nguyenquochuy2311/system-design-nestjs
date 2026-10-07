import { CATEGORIES } from '../../../../src/shared/catalog-data';
import { CatalogGrid } from '../../catalog-grid';

// Trang danh mục dựng sẵn lúc build (HTML giống nhau cho mọi khách); danh sách và giá lấy từ /api/products trên trình
// duyệt, qua CDN, để giá mới trong vòng 60 giây mà HTML không phải dựng lại.
export const dynamicParams = false;
export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = CATEGORIES.find((c) => c.slug === slug);
  return (
    <>
      <h1>{category?.name ?? slug}</h1>
      <CatalogGrid category={slug} />
    </>
  );
}
