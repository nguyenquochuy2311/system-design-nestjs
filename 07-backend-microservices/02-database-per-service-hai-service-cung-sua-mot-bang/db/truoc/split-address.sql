-- Đội shipping tách address để tối ưu chia tuyến. Trong database dùng chung, đây cũng là bảng order-service đang ghi.
ALTER TABLE shared.orders ADD COLUMN street text, ADD COLUMN ward text, ADD COLUMN district text;
UPDATE shared.orders
SET street = split_part(address, ', ', 1), ward = split_part(address, ', ', 2), district = split_part(address, ', ', 3);
ALTER TABLE shared.orders DROP COLUMN address;
