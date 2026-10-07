-- Chạy: pnpm db:seed   (biến :contracts truyền qua psql -v, mặc định 40000 như mục 1 README). Chạy lại được.
-- Nạp CÙNG một bộ dữ liệu vào truoc.* và public.*: đây là dữ liệu "có sẵn trước khi bật nhật ký", nên chạy
-- với session_replication_role = replica (chỉ superuser) để trigger không chạy — kể cả trigger nhật ký và
-- trigger chặn TRUNCATE trên audit.audit_log (nếu migration đã chạy, nhật ký cũ của test / đo bị xóa sạch).
\set ON_ERROR_STOP on
SET session_replication_role = replica;

TRUNCATE truoc.claims, truoc.contracts, truoc.app_audit_log RESTART IDENTITY;
TRUNCATE public.claims, public.contracts RESTART IDENTITY;
DO $$
BEGIN
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    EXECUTE 'TRUNCATE audit.audit_log RESTART IDENTITY';
  END IF;
END $$;

INSERT INTO truoc.contracts (id, code, customer_name, product, premium, sum_insured, start_date, end_date, updated_by, updated_at)
SELECT g,
       'HD-' || lpad(g::text, 6, '0'),
       'Công ty khách hàng ' || g,
       (ARRAY['Tài sản', 'Trách nhiệm công cộng', 'Hàng hóa vận chuyển', 'Xây dựng lắp đặt'])[1 + g % 4],
       (20 + g % 200) * 1000000::bigint,  -- phí 20–219 triệu đồng
       (5000 + g % 5000) * 1000000::bigint, -- số tiền bảo hiểm 5–10 tỷ đồng
       date '2026-01-01' + g % 365,
       date '2027-01-01' + g % 365,
       'nv-' || (1 + g % 300),
       date_trunc('second', now()) - make_interval(days => g % 365)
FROM generate_series(1, :contracts) AS g;

-- Một phần mười số hợp đồng có hai hồ sơ bồi thường.
INSERT INTO truoc.claims (contract_id, amount, status)
SELECT c, (1 + c % 50) * 1000000::bigint, 'open'
FROM generate_series(10, :contracts, 10) AS c CROSS JOIN generate_series(1, 2);

-- Liệt kê cột: chạy được cả trước lẫn sau migration 002 (public.contracts có thêm deleted_at, deleted_by).
INSERT INTO public.contracts (id, code, customer_name, product, premium, sum_insured, start_date, end_date, updated_by, updated_at)
SELECT id, code, customer_name, product, premium, sum_insured, start_date, end_date, updated_by, updated_at FROM truoc.contracts;
INSERT INTO public.claims (contract_id, amount, status)
SELECT contract_id, amount, status FROM truoc.claims ORDER BY id;

SELECT setval(pg_get_serial_sequence('truoc.contracts', 'id'), (SELECT max(id) FROM truoc.contracts));
SELECT setval(pg_get_serial_sequence('public.contracts', 'id'), (SELECT max(id) FROM public.contracts));

RESET session_replication_role;
ANALYZE truoc.contracts, truoc.claims, public.contracts, public.claims;

SELECT (SELECT count(*) FROM public.contracts) AS contracts, (SELECT count(*) FROM public.claims) AS claims;
