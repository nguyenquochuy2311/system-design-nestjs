-- Seed :products sản phẩm (mặc định 200.000 như mục 1), 2.000 shop, 1–4 biến thể và 3–5 ảnh mỗi sản phẩm.
-- Giá trị tất định (số học trên id, không random()) để hai lần seed cho cùng dữ liệu. Chạy lại được: TRUNCATE trước.
-- pnpm db:seed   (hoặc PRODUCTS=20000 pnpm db:seed)
BEGIN;
TRUNCATE product_images, variant_prices, product_variants, products, shop_ratings RESTART IDENTITY;

INSERT INTO shop_ratings (shop_id, rating_avg, rating_count)
SELECT s, round(3.5 + (s * 37 % 150) / 100.0, 2), 50 + (s * 7919 % 20000)
FROM generate_series(1, 2000) AS s;

INSERT INTO products (id, shop_id, name, description, category, updated_at)
SELECT g,
       1 + (g::bigint * 7919 % 2000),
       'Sản phẩm ' || g || ' – ' || (ARRAY['Áo thun cotton', 'Tai nghe Bluetooth', 'Nồi chiên không dầu', 'Sữa rửa mặt', 'Balo laptop', 'Bình giữ nhiệt'])[1 + g % 6],
       repeat('Mô tả chi tiết sản phẩm ' || g || ': chất liệu, kích thước, hướng dẫn sử dụng và bảo hành. ', 3),
       (ARRAY['thoi-trang', 'dien-tu', 'gia-dung', 'my-pham', 'phu-kien', 'the-thao'])[1 + g % 6],
       timestamptz '2026-10-01 00:00:00+07' + (g % 86400) * interval '1 second'
FROM generate_series(1, :products) AS g;

INSERT INTO product_variants (product_id, sku, name, stock)
SELECT g, 'SKU-' || g || '-' || v, 'Phân loại ' || v, (g * 31 + v * 17) % 500
FROM generate_series(1, :products) AS g, generate_series(1, 1 + g % 4) AS v;

INSERT INTO variant_prices (variant_id, price, list_price)
SELECT id, (50 + id::bigint * 7919 % 4950) * 1000, (50 + id::bigint * 7919 % 4950) * 1200
FROM product_variants;

INSERT INTO product_images (product_id, url, position)
SELECT g, 'https://cdn.shop.example/p/' || g || '/' || i || '.jpg', i
FROM generate_series(1, :products) AS g, generate_series(1, 3 + g % 3) AS i;

-- products được chèn id tường minh: dời sequence của identity để sản phẩm tạo sau (test) không trùng id.
SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products));
COMMIT;

VACUUM ANALYZE;
SELECT (SELECT count(*) FROM products) AS products,
       (SELECT count(*) FROM product_variants) AS variants,
       (SELECT count(*) FROM product_images) AS images,
       pg_size_pretty(pg_database_size(current_database())) AS db_size;
