-- Chạy một lần khi volume dữ liệu còn trống (entrypoint của image postgres). Mật khẩu đọc từ biến môi trường
-- bằng \getenv và đưa vào câu lệnh bằng format(%L) \gexec (mẫu bài 17/05), không ghi cứng trong file.
\getenv shop_app_password SHOP_APP_PASSWORD
\getenv exporter_password EXPORTER_PASSWORD

SELECT format('CREATE ROLE shop_app LOGIN PASSWORD %L', :'shop_app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') \gexec

-- postgres_exporter chỉ cần đọc thống kê: role pg_monitor có sẵn của PostgreSQL, không cần superuser.
SELECT format('CREATE ROLE exporter LOGIN PASSWORD %L IN ROLE pg_monitor', :'exporter_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exporter') \gexec

CREATE TABLE IF NOT EXISTS orders (
  id          bigserial PRIMARY KEY,
  customer_id int         NOT NULL,
  subtotal    int         NOT NULL,
  discount    int         NOT NULL,
  total       int         NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id bigint NOT NULL REFERENCES orders (id),
  sku      text   NOT NULL,
  qty      int    NOT NULL,
  price    int    NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

GRANT SELECT, INSERT ON orders, order_items TO shop_app;
GRANT USAGE ON SEQUENCE orders_id_seq TO shop_app;

-- 1.000 đơn có sẵn để "xem đơn" (GET /orders/:id) có dữ liệu ngay khi dựng.
INSERT INTO orders (customer_id, subtotal, discount, total)
SELECT (g % 500) + 1, 250000, 0, 250000 FROM generate_series(1, 1000) AS g
WHERE NOT EXISTS (SELECT 1 FROM orders);
INSERT INTO order_items (order_id, sku, qty, price)
SELECT id, 'SKU-' || (id % 50), 1, 250000 FROM orders
WHERE NOT EXISTS (SELECT 1 FROM order_items);
