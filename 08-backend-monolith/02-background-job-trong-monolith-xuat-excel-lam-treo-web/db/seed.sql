-- Dữ liệu đo: tenant 1 có ROWS đơn trong tháng 9/2026 (mặc định 50.000) và 5 kế toán; tenant 2 nhận đơn mới khi đo.
-- Chạy lại được: xóa sạch dữ liệu cũ và hàng đợi rồi tạo lại. Đổi quy mô: psql -v rows=20000 -f seed.sql
\if :{?rows}
\else
  \set rows 50000
\endif

BEGIN;
TRUNCATE export_jobs, orders, users, tenants RESTART IDENTITY CASCADE;
SELECT pgmq.purge_queue('exports');
DELETE FROM pgmq.a_exports;

INSERT INTO tenants (name) VALUES ('Chuỗi cửa hàng Minh An'), ('Chuỗi cửa hàng Phú Lộc');
INSERT INTO users (tenant_id, name, role)
SELECT 1, 'Kế toán ' || g, 'accountant' FROM generate_series(1, 5) g;
INSERT INTO users (tenant_id, name, role) VALUES (2, 'Nhân viên bán hàng', 'sales');

-- Số tiền tính bằng đồng; created_at trải đều trong tháng 9/2026 (giờ Việt Nam)
INSERT INTO orders (tenant_id, code, store_name, customer_name, customer_phone, status, item_count, subtotal, discount, total, created_at)
SELECT 1,
       'DH' || lpad(g::text, 8, '0'),
       'Cửa hàng số ' || (1 + g % 40),
       'Khách hàng ' || (1 + (g * 7919) % 20000),
       '09' || lpad(((g * 104729) % 100000000)::text, 8, '0'),
       (ARRAY['paid', 'paid', 'paid', 'shipped', 'cancelled'])[1 + g % 5],
       1 + g % 7,
       s.subtotal,
       CASE WHEN s.subtotal >= 1000000 THEN s.subtotal / 20 ELSE 0 END,
       s.subtotal - CASE WHEN s.subtotal >= 1000000 THEN s.subtotal / 20 ELSE 0 END,
       timestamptz '2026-09-01 00:00:00+07' + ((g - 1)::double precision / :rows) * interval '30 days'
FROM generate_series(1::bigint, :rows) g
CROSS JOIN LATERAL (SELECT (50000 + (g * 2654435761::bigint) % 3000000) AS subtotal) s;
COMMIT;

ANALYZE orders;
SELECT count(*) AS orders_thang_9 FROM orders WHERE tenant_id = 1;
