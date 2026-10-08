-- Chạy: pnpm db:seed   (biến psql: rows, merchants, big, big_share; xem package.json)
-- Sinh dữ liệu xác định (không random): chạy lại cho đúng cùng dữ liệu, và đưa bảng về trạng thái "trước"
-- (bỏ index của pattern). Dòng được nhóm thành khối 5 dòng cùng merchant:
--   - khối có b % 4 = 0: cả 5 dòng TRÙNG created_at (giao dịch nhập theo lô), 25 % số dòng nằm trong nhóm trùng.
--     Nhóm trùng trọn trong một khối, nên với cỡ trang chia hết cho 5 (như 20) ranh giới trang không cắt ngang nhóm;
--     trường hợp cắt ngang do test kiểm (test/keyset-ties-on-created-at.test.ts);
--   - khối khác: 5 dòng lệch nhau 1 micro giây → bắt lỗi làm tròn created_at về mili giây (Date của JavaScript).
-- Merchant chọn theo hàm băm của số khối: `big` merchant lớn (id 1..big) chiếm tỉ lệ big_share số dòng, phần còn lại chia đều.
\set ON_ERROR_STOP on
\timing on

SELECT (90 * 86400.0) / (:rows / 5) AS step_secs \gset

DROP INDEX IF EXISTS transactions_merchant_created_id_idx;
DROP INDEX IF EXISTS transactions_merchant_id_idx;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_pkey;
TRUNCATE transactions;

INSERT INTO transactions (id, merchant_id, created_at, amount, kind, description)
SELECT g,
       CASE WHEN h.u < :big_share THEN 1 + floor(h.u / :big_share * :big)::int
            ELSE :big + 1 + floor((h.u - :big_share) / (1 - :big_share) * (:merchants - :big))::int END,
       timestamptz '2026-07-01 00:00:00+00'
         + make_interval(secs => blk.b * :step_secs)
         + (CASE WHEN blk.b % 4 = 0 THEN 0 ELSE blk.k END) * interval '1 microsecond',
       10000 + (g::bigint * 7919) % 5000000,
       (ARRAY['payment', 'payment', 'payment', 'refund', 'payout'])[1 + g % 5],
       'Thanh toán đơn #' || g
FROM generate_series(1, :rows) AS g
CROSS JOIN LATERAL (SELECT (g - 1) / 5 AS b, (g - 1) % 5 AS k) AS blk
CROSS JOIN LATERAL (SELECT ((blk.b::bigint * 2654435761) % 4294967296) / 4294967296.0 AS u) AS h;

SET maintenance_work_mem = '256MB';
ALTER TABLE transactions ADD PRIMARY KEY (id);
CREATE INDEX transactions_merchant_id_idx ON transactions (merchant_id);
RESET maintenance_work_mem;
SELECT setval(pg_get_serial_sequence('transactions', 'id'), (SELECT max(id) FROM transactions));

-- Đặt hint bit và visibility map ngay, để lần đọc đầu trong lúc đo không phải ghi lại trang.
VACUUM (ANALYZE) transactions;

SELECT count(*) AS rows,
       pg_size_pretty(pg_relation_size('transactions')) AS heap,
       pg_size_pretty(pg_indexes_size('transactions')) AS indexes,
       pg_size_pretty(pg_database_size(current_database())) AS database
FROM transactions;
