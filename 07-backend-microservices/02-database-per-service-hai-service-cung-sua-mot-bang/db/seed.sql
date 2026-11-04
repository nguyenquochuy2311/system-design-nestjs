-- Seed cho lượt đo, chạy bằng superuser sau migration 001: dữ liệu giống nhau cho hai bản.
-- 100.000 đơn trải đều 30 ngày trên 100 vùng, mỗi đơn một lần giao. Bản sao shipment_orders là bước backfill lúc chuyển đổi.
INSERT INTO shared.shops (id, name)
SELECT format('SHOP-%s', n), format('Shop %s', n) FROM generate_series(1, 100) AS n;

INSERT INTO shared.orders (id, shop_id, address, delivery_window, zone_code, total_vnd, status, created_at)
SELECT gen_random_uuid(), format('SHOP-%s', n % 100 + 1), format('%s Lê Lợi, Phường %s, Quận %s', n, n % 20 + 1, n % 12 + 1),
  '08:00-12:00', format('Z%s', n % 100), 50000 + n % 1000 * 100, 'DELIVERED', now() - (n % 2592000) * interval '1 second'
FROM generate_series(1, 100000) AS n;

INSERT INTO shared.delivery_attempts (order_id, outcome, attempted_at)
SELECT id, CASE WHEN total_vnd % 700 = 0 THEN 'FAILED' ELSE 'DELIVERED' END, created_at + interval '3 hours' FROM shared.orders;

INSERT INTO ordering.shops SELECT * FROM shared.shops;
INSERT INTO ordering.orders (id, shop_id, address, delivery_window, zone_code, total_vnd, created_at)
SELECT id, shop_id, address, delivery_window, zone_code, total_vnd, created_at FROM shared.orders;

INSERT INTO shipping.shipment_orders (order_id, address, delivery_window, zone_code, order_version, event_occurred_at, created_at)
SELECT id, address, delivery_window, zone_code, 1, created_at, created_at FROM shared.orders;
INSERT INTO shipping.delivery_attempts (order_id, outcome, attempted_at)
SELECT order_id, outcome, attempted_at FROM shared.delivery_attempts;

ANALYZE;
