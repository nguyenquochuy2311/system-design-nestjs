-- Dữ liệu giống nhau cho hai bản, chạy lại được: test gọi lại file này trước mỗi kịch bản.
-- 1.000 khách và 1.000 SKU, tồn kho rất lớn để lượt đo không cạn hàng giữa chừng. KH-0000 là khách đã khóa.
TRUNCATE truoc.users, truoc.products, truoc.stock, truoc.promotions, truoc.payments, truoc.orders;
TRUNCATE catalog.products;
TRUNCATE ordering.order_lines, ordering.orders, ordering.customers, ordering.promotions,
  ordering.product_snapshots, ordering.quarantined_events;
TRUNCATE inventory.reservations, inventory.stock_items;
TRUNCATE payment.transactions;
SELECT pgmq.purge_queue('catalog_events');
DELETE FROM pgmq.a_catalog_events;

INSERT INTO truoc.users (id, active)
SELECT format('KH-%s', lpad(n::text, 4, '0')), n > 0 FROM generate_series(0, 1000) AS n;

INSERT INTO truoc.products (sku, name, description, image_url, category, price_vnd)
SELECT format('SKU-%s', lpad(n::text, 4, '0')), format('Sản phẩm %s', n), format('Mô tả dài của sản phẩm %s', n),
  format('https://cdn.lab.test/%s.jpg', n), format('Danh mục %s', n % 20), 10000 * (n % 100 + 1)
FROM generate_series(1, 1000) AS n;

INSERT INTO truoc.stock (sku, on_hand)
SELECT format('SKU-%s', lpad(n::text, 4, '0')), 100000000 FROM generate_series(1, 1000) AS n;

INSERT INTO truoc.promotions (code, percent_off) VALUES ('TET10', 10);

INSERT INTO catalog.products (sku, display_name, description, image_url, category, list_price_vnd)
SELECT sku, name, description, image_url, category, price_vnd FROM truoc.products;

INSERT INTO ordering.customers (id, active) SELECT id, active FROM truoc.users;
INSERT INTO ordering.promotions (code, percent_off) SELECT code, percent_off FROM truoc.promotions;

-- Bản sao ban đầu: lúc chuyển đổi thật đây là bước backfill từ Catalog, sau đó sự kiện giữ cho bản sao mới.
INSERT INTO ordering.product_snapshots (sku, product_name, unit_price_vnd, price_version)
SELECT sku, display_name, list_price_vnd, price_version FROM catalog.products;

INSERT INTO inventory.stock_items (sku, on_hand) SELECT sku, on_hand FROM truoc.stock;
