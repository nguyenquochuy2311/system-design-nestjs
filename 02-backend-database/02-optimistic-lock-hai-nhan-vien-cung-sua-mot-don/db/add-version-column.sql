-- [PATTERN] Migration thêm cột version cho Optimistic Offline Lock. Chạy lại được (IF NOT EXISTS).
-- Từ PostgreSQL 11, ADD COLUMN với DEFAULT hằng số không viết lại bảng: giá trị mặc định lưu trong catalog
-- (pg_attribute.atthasmissing = true cho các dòng có sẵn), nên chạy gần như tức thì kể cả trên bảng lớn.
\timing on
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
\timing off
SELECT attname, atthasmissing
FROM pg_attribute
WHERE attrelid = 'shipments'::regclass AND attname = 'version';
