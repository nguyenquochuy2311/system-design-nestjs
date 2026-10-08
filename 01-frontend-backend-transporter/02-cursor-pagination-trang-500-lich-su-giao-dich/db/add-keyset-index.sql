-- [PATTERN] Index phức hợp: cột lọc đứng đầu, sau đó đúng thứ tự ORDER BY của truy vấn seek (kể cả khóa phụ id).
-- CONCURRENTLY: không chặn ghi trên bảng đang chạy; phải là câu lệnh đơn, ngoài transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_merchant_created_id_idx
  ON transactions (merchant_id, created_at DESC, id DESC);
