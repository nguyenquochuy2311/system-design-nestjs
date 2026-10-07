-- Job nhập giá hàng loạt, bản TRƯỚC: đội dữ liệu COPY file CSV vào price_import rồi chạy file này lúc 0h.
-- Chỉ ghi PostgreSQL. Không ai báo cho cache: trang nào đang giữ giá cũ thì giữ tới hết TTL 15 phút.
--   VARIANT=truoc pnpm job:csv
BEGIN;
UPDATE products p
SET price = i.new_price, price_changed_at = clock_timestamp()
FROM price_import i
WHERE i.product_id = p.id AND i.applied_at IS NULL;

UPDATE price_import SET applied_at = clock_timestamp() WHERE applied_at IS NULL;
COMMIT;
