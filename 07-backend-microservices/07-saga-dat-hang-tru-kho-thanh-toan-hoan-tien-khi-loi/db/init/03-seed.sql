-- Dữ liệu giống nhau cho hai bản, chạy lại được: test gọi lại file này trước mỗi kịch bản.
-- 1.000 SKU, tồn kho rất lớn: lượt đo không cạn hàng giữa chừng, và lệch tồn kho không bị che bởi hết hàng thật.
TRUNCATE ordering.order_saga_transitions, ordering.order_sagas, ordering.orders;
TRUNCATE inventory.reservations, inventory.stock_items;
TRUNCATE payment.payments;
TRUNCATE truoc.reservations, truoc.orders, truoc.stock_items;
SELECT pgmq.purge_queue('inventory_commands');
SELECT pgmq.purge_queue('payment_commands');
SELECT pgmq.purge_queue('saga_replies');
DELETE FROM pgmq.a_inventory_commands;
DELETE FROM pgmq.a_payment_commands;
DELETE FROM pgmq.a_saga_replies;

INSERT INTO inventory.stock_items (sku, on_hand)
SELECT format('SKU-%s', lpad(n::text, 4, '0')), 100000000 FROM generate_series(1, 1000) AS n;
INSERT INTO truoc.stock_items (sku, on_hand) SELECT sku, on_hand FROM inventory.stock_items;
