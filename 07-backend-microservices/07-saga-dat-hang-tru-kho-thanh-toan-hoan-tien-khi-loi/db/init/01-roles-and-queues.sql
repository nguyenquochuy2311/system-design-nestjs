-- Chạy một lần khi tạo volume. Ba service, ba schema, ba role; lệnh và trả lời đi qua PGMQ.
-- Mọi schema chung một PostgreSQL nên mỗi service gửi message cùng transaction được. Tách máy chủ thì cần Outbox (14/03).
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('inventory_commands');
SELECT pgmq.create('payment_commands');
SELECT pgmq.create('saga_replies');

CREATE ROLE order_rw LOGIN PASSWORD 'order_rw';
CREATE ROLE inventory_rw LOGIN PASSWORD 'inventory_rw';
CREATE ROLE payment_rw LOGIN PASSWORD 'payment_rw';
CREATE ROLE truoc_rw LOGIN PASSWORD 'truoc_rw';

GRANT USAGE ON SCHEMA pgmq TO order_rw, inventory_rw, payment_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO order_rw, inventory_rw, payment_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmq TO order_rw, inventory_rw, payment_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO order_rw, inventory_rw, payment_rw;
