-- Job nhập giá hàng loạt, bản SAU: giống hệt bản trước, thêm đúng một câu INSERT vào outbox.
-- Đội dữ liệu không phải gọi Redis; worker invalidation đọc outbox sau khi transaction này commit.
--   VARIANT=sau pnpm job:csv
BEGIN;
UPDATE products p
SET price = i.new_price, price_changed_at = clock_timestamp()
FROM price_import i
WHERE i.product_id = p.id AND i.applied_at IS NULL;

-- [PATTERN] sự kiện "giá đã đổi" cho mọi dòng vừa áp dụng, cùng transaction với lần đổi giá
INSERT INTO price_outbox (product_id, source) SELECT product_id, 'csv' FROM price_import WHERE applied_at IS NULL;

UPDATE price_import SET applied_at = clock_timestamp() WHERE applied_at IS NULL;
COMMIT;
