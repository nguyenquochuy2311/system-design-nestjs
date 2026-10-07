-- [PATTERN] Index cho phía tham chiếu của khóa ngoại. CONCURRENTLY để không chặn ghi trên bảng đang chạy.
-- Không chạy trong transaction (psql -f / stdin chạy từng câu riêng là đúng).
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS shipments_order_id_idx ON shipments (order_id);
ANALYZE order_items;
ANALYZE shipments;
