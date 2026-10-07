-- Chạy: pnpm db:seed   (biến :shipments truyền qua psql -v, mặc định 10000). Chạy lại được (TRUNCATE đầu file).
-- Giờ hẹn làm tròn tới phút để chuỗi ISO trên form (độ chính xác mili giây) khớp đúng giá trị trong DB.
\set ON_ERROR_STOP on
TRUNCATE shipments RESTART IDENTITY;

INSERT INTO shipments (id, tracking_code, recipient_name, address, appointment_at, cod_cents, note)
SELECT g,
       'VD' || lpad(g::text, 8, '0'),
       'Người nhận ' || g,
       g || ' đường Số ' || (1 + g % 50) || ', phường ' || (1 + g % 20) || ', TP. Hồ Chí Minh',
       date_trunc('minute', now()) + make_interval(hours => 24 + g % 72),
       (g % 40) * 50000,
       ''
FROM generate_series(1, :shipments) AS g;

-- Đồng bộ sequence của cột identity để test tạo vận đơn mới không trùng khóa.
SELECT setval(pg_get_serial_sequence('shipments', 'id'), (SELECT max(id) FROM shipments));

ANALYZE shipments;
