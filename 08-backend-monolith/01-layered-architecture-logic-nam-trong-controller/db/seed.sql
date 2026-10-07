-- Dữ liệu cho script đo HTTP: 200 sản phẩm (mỗi sản phẩm thứ 5 là hàng khuyến mãi) và 1.000 khách
-- hạn mức rất lớn để đơn đo tải không bị từ chối. Test không dùng seed: mỗi test tự tạo khách và sản phẩm riêng.
-- Chạy lại được: chỉ chèn khi chưa có mã.
INSERT INTO products (sku, name, unit_price, is_promo)
SELECT 'BENCH-P' || g, 'Vật tư ' || g, 10000 * (1 + (g * 37) % 500), g % 5 = 0
FROM generate_series(1, 200) AS g
ON CONFLICT (sku) DO NOTHING;

INSERT INTO customers (code, name, email, tier, credit_limit)
SELECT 'BENCH-C' || g, 'Đại lý ' || g, 'dai-ly-' || g || '@example.test',
       (ARRAY['standard', 'silver', 'gold', 'diamond'])[1 + g % 4], 1000000000000000
FROM generate_series(1, 1000) AS g
ON CONFLICT (code) DO NOTHING;

SELECT (SELECT count(*) FROM products WHERE sku LIKE 'BENCH-P%') AS bench_products,
       (SELECT count(*) FROM customers WHERE code LIKE 'BENCH-C%') AS bench_customers;
