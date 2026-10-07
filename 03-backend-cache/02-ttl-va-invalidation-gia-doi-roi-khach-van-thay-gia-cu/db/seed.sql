-- Seed :products sản phẩm (mặc định 20.000) rải đều 6 danh mục theo id % 6, 12 sản phẩm "deal hôm nay" (id 1–12).
-- Giá tất định (số học trên id). Chạy lại được: TRUNCATE trước, nên cũng dùng để đưa giá về ban đầu giữa các lượt đo.
-- pnpm db:seed   (hoặc PRODUCTS=2000 pnpm db:seed)
BEGIN;
TRUNCATE orders, price_outbox, price_import, promotions, home_deals, products RESTART IDENTITY;

INSERT INTO products (id, category, name, list_price, price, price_changed_at)
SELECT g,
       (ARRAY['thoi-trang', 'dien-tu', 'gia-dung', 'my-pham', 'phu-kien', 'the-thao'])[1 + g % 6],
       'Sản phẩm ' || g,
       (50 + g::bigint * 7919 % 4950) * 1000,
       (50 + g::bigint * 7919 % 4950) * 1000,
       timestamptz '2026-10-01 00:00:00+07'
FROM generate_series(1, :products) AS g;

INSERT INTO home_deals (position, product_id)
SELECT g, g FROM generate_series(1, 12) AS g;

-- products được chèn id tường minh: dời sequence của identity để sản phẩm tạo sau (test) không trùng id.
SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products));
COMMIT;

VACUUM ANALYZE;
SELECT (SELECT count(*) FROM products) AS products,
       (SELECT count(DISTINCT category) FROM products) AS categories,
       (SELECT count(*) FROM home_deals) AS home_deals,
       pg_size_pretty(pg_database_size(current_database())) AS db_size;
