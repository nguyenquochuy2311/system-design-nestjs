-- Bốn service, bốn schema, bốn role như bài 02: không role nào đọc được dữ liệu của service khác.
CREATE ROLE order_rw LOGIN PASSWORD 'order_rw';
CREATE ROLE payment_rw LOGIN PASSWORD 'payment_rw';
CREATE ROLE shipping_rw LOGIN PASSWORD 'shipping_rw';
CREATE ROLE customer_rw LOGIN PASSWORD 'customer_rw';

CREATE SCHEMA ordering AUTHORIZATION order_rw;
CREATE SCHEMA payment AUTHORIZATION payment_rw;
CREATE SCHEMA shipping AUTHORIZATION shipping_rw;
CREATE SCHEMA customer AUTHORIZATION customer_rw;

CREATE TABLE ordering.orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  total_vnd bigint NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX ON ordering.orders (customer_id, created_at DESC);

CREATE TABLE payment.payments (
  order_id text PRIMARY KEY,
  status text NOT NULL
);

CREATE TABLE shipping.shipments (
  order_id text PRIMARY KEY,
  status text NOT NULL,
  carrier text NOT NULL
);

CREATE TABLE customer.customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  tier text NOT NULL
);

ALTER TABLE ordering.orders OWNER TO order_rw;
ALTER TABLE payment.payments OWNER TO payment_rw;
ALTER TABLE shipping.shipments OWNER TO shipping_rw;
ALTER TABLE customer.customers OWNER TO customer_rw;

-- 10.000 đơn của 500 khách, mỗi khách 20 đơn: đúng màn hình danh sách 20 đơn.
INSERT INTO customer.customers (id, name, tier)
SELECT format('KH-%s', n), format('Khách %s', n), (ARRAY['Đồng', 'Bạc', 'Vàng'])[n % 3 + 1] FROM generate_series(1, 500) AS n;

INSERT INTO ordering.orders (id, customer_id, total_vnd, created_at)
SELECT format('DH-%s', n), format('KH-%s', (n - 1) % 500 + 1), 100000 + n % 100 * 1000, now() - n * interval '1 minute'
FROM generate_series(1, 10000) AS n;

INSERT INTO payment.payments (order_id, status) SELECT id, 'PAID' FROM ordering.orders;
INSERT INTO shipping.shipments (order_id, status, carrier) SELECT id, 'DELIVERING', 'Giao Nhanh' FROM ordering.orders;
