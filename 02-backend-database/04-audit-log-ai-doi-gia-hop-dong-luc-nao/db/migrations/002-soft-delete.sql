-- [PATTERN] Soft Delete: "xóa" hợp đồng là đánh dấu deleted_at / deleted_by, dòng và hồ sơ bồi thường
-- tham chiếu tới nó vẫn còn, nên khôi phục được bằng một câu UPDATE và không làm mồ côi hồ sơ.
-- Chạy bằng superuser postgres, sau 001. Chạy lại được.
BEGIN;

-- Thêm cột cho phép NULL, không DEFAULT: không viết lại bảng, chạy gần như tức thì kể cả trên bảng lớn.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

-- [PATTERN] Mã hợp đồng chỉ cần duy nhất trong các hợp đồng CÒN HIỆU LỰC: bản đã xóa mềm không chiếm chỗ,
-- nên tạo lại được hợp đồng cùng mã. (Bảng lớn đang chạy: dùng CREATE INDEX CONCURRENTLY ngoài transaction.)
CREATE UNIQUE INDEX IF NOT EXISTS contracts_code_active_key ON public.contracts (code) WHERE deleted_at IS NULL;
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_code_key;

-- Hồ sơ bồi thường không bao giờ bị xóa theo hợp đồng: CASCADE đổi thành RESTRICT.
-- (Bảng lớn: ADD CONSTRAINT ... NOT VALID rồi VALIDATE CONSTRAINT để không khóa ghi lâu.)
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_contract_id_fkey;
ALTER TABLE public.claims
  ADD CONSTRAINT claims_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts (id) ON DELETE RESTRICT;

-- [PATTERN] Truy vấn thường đọc qua view đã lọc bản xóa mềm; quên lọc là lỗi hay gặp nhất của soft delete.
-- Liệt kê cột thay vì SELECT *: view lưu danh sách cột lúc tạo, cột thêm sau sẽ không tự xuất hiện.
CREATE OR REPLACE VIEW public.active_contracts AS
  SELECT id, code, customer_name, product, premium, sum_insured, start_date, end_date, updated_by, updated_at
  FROM public.contracts
  WHERE deleted_at IS NULL;
GRANT SELECT ON public.active_contracts TO contract_app, dba_lan;

-- Ứng dụng không xóa cứng được nữa; DBA vẫn xóa được (và lệnh DELETE đó vẫn vào nhật ký với bản cũ đầy đủ).
REVOKE DELETE ON public.contracts, public.claims FROM contract_app;

COMMIT;
