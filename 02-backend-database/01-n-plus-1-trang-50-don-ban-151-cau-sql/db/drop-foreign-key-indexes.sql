-- Đưa schema về trạng thái "trước" để đo lại.
DROP INDEX CONCURRENTLY IF EXISTS order_items_order_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS shipments_order_id_idx;
