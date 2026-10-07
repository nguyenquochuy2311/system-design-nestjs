import { CATEGORIES } from '../../src/shared/catalog-data';

export default function HomePage() {
  return (
    <>
      <h1>Danh mục</h1>
      <nav className="categories">
        {CATEGORIES.map((c) => (
          <a key={c.slug} href={`/danh-muc/${c.slug}`}>
            {c.name}
          </a>
        ))}
      </nav>
    </>
  );
}
