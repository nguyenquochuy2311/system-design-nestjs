-- Seed ví cho kịch bản đo: mặc định 100.000 ví (đổi bằng WALLETS=...), id 1..N, số dư lớn để không hết tiền khi đo.
-- Chạy lại được: xóa sổ chuyển tiền và ví cũ rồi sinh lại, đặt lại identity để id bắt đầu từ 1.
\set ON_ERROR_STOP 1
\timing on
TRUNCATE transfers, wallets RESTART IDENTITY;

INSERT INTO wallets (owner_name, balance)
SELECT 'Khách ' || g, 1000000000
FROM generate_series(1, :wallets) AS g;

ANALYZE wallets;
SELECT count(*) AS wallets, sum(balance) AS total_balance FROM wallets;
