-- Chạy một lần khi tạo volume, bằng superuser. Từ đây về sau mỗi service tự chạy migration bằng role của chính nó.
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('order_events');

CREATE ROLE order_rw LOGIN PASSWORD 'order_rw';
CREATE ROLE shipping_rw LOGIN PASSWORD 'shipping_rw';
CREATE ROLE truoc_order LOGIN PASSWORD 'truoc_order';
CREATE ROLE truoc_shipping LOGIN PASSWORD 'truoc_shipping';

-- Mỗi service là chủ schema của mình, nên đổi cấu trúc không cần xin ai và cũng không đụng được schema còn lại.
CREATE SCHEMA ordering AUTHORIZATION order_rw;
CREATE SCHEMA shipping AUTHORIZATION shipping_rw;

-- Hàng đợi là bề mặt ghi chung duy nhất, nên mỗi role chỉ có đúng quyền cho vai của mình: order_rw gửi, shipping_rw đọc.
GRANT USAGE ON SCHEMA pgmq TO order_rw, shipping_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO order_rw, shipping_rw;
GRANT SELECT ON pgmq.meta TO order_rw, shipping_rw;
GRANT SELECT, INSERT ON pgmq.q_order_events TO order_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmq TO order_rw;
GRANT SELECT, UPDATE, DELETE ON pgmq.q_order_events TO shipping_rw;
GRANT SELECT, INSERT ON pgmq.a_order_events TO shipping_rw;
