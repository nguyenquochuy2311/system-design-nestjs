-- Chạy: pnpm db:seed   (biến :orders và :customers truyền qua psql -v)
-- Mỗi đơn có 3 dòng sản phẩm; 90% đơn có một bản ghi giao hàng. Chạy lại được (TRUNCATE đầu file).
\set ON_ERROR_STOP on
TRUNCATE shipments, order_items, orders, customers RESTART IDENTITY;

INSERT INTO customers (id, name, email)
SELECT g, 'Khách ' || g, 'khach' || g || '@example.test'
FROM generate_series(1, :customers) AS g;

INSERT INTO orders (id, customer_id, status, total_cents, created_at)
SELECT g,
       1 + ((g::bigint * 7919) % :customers)::integer,
       (ARRAY['new', 'paid', 'packing', 'shipped', 'delivered'])[1 + g % 5],
       100000 + (g % 900) * 1000,
       now() - make_interval(secs => (:orders - g))
FROM generate_series(1, :orders) AS g;

INSERT INTO order_items (id, order_id, product_name, quantity, price_cents)
SELECT o.id * 3 + k, o.id, 'Sản phẩm ' || ((o.id * (k + 1)) % 500), 1 + k, 50000 + k * 10000
FROM orders AS o CROSS JOIN generate_series(0, 2) AS k;

INSERT INTO shipments (id, order_id, status, carrier)
SELECT o.id, o.id,
       (ARRAY['pending', 'in_transit', 'delivered'])[1 + o.id % 3],
       (ARRAY['carrier-a', 'carrier-b', 'carrier-c'])[1 + o.id % 3]
FROM orders AS o
WHERE o.id % 10 <> 0;

-- Đồng bộ sequence của cột identity để POST /place-order chèn tiếp không trùng khóa.
SELECT setval(pg_get_serial_sequence('customers', 'id'), (SELECT max(id) FROM customers));
SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT max(id) FROM orders));
SELECT setval(pg_get_serial_sequence('order_items', 'id'), (SELECT max(id) FROM order_items));
SELECT setval(pg_get_serial_sequence('shipments', 'id'), (SELECT max(id) FROM shipments));

ANALYZE;
