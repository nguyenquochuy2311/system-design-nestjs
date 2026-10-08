-- 10.000 ví dùng cho đo, mỗi ví 1.000 tỉ đồng để không ví nào cạn tiền giữa các lượt đo.
INSERT INTO wallets (user_id, balance)
SELECT g, 1000000000000 FROM generate_series(1, 10000) AS g;
ANALYZE wallets;
