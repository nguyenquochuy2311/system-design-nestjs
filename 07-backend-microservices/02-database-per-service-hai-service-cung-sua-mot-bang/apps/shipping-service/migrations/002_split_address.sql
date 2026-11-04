-- Cùng thay đổi đã làm sập order-service ở bản "trước", nhưng nay chỉ đụng tới schema của shipping.
ALTER TABLE shipping.shipment_orders ADD COLUMN street text, ADD COLUMN ward text, ADD COLUMN district text;
UPDATE shipping.shipment_orders
SET street = split_part(address, ', ', 1), ward = split_part(address, ', ', 2), district = split_part(address, ', ', 3);
ALTER TABLE shipping.shipment_orders DROP COLUMN address;
