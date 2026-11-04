-- Hàng đợi sự kiện giữa các context. Tách riêng file này vì đây là phần duy nhất phụ thuộc extension PGMQ.
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('catalog_events');
