-- Kế hoạch của câu "getItems" ngây thơ cho một đơn, kèm buffer. So sánh trước/sau khi có index.
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM order_items WHERE order_id = 250000;
