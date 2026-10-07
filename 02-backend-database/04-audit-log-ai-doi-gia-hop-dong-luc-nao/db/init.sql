-- Chạy một lần khi volume mới (docker-entrypoint-initdb.d), bằng superuser postgres.
-- Dựng "hệ thống hiện tại" ở hai schema giống hệt nhau:
--   truoc  : giữ nguyên để test và đo phía "trước" chạy song song với "sau" trên cùng database;
--   public : cùng bảng đó, sẽ được nâng cấp bằng db/migrations/001-audit-log.sql và 002-soft-delete.sql.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Bốn "đường ghi" ở mục 1 README dùng ba tài khoản DB khác nhau (không ai là superuser):
CREATE ROLE contract_app LOGIN PASSWORD 'contract_app'; -- API và job nền
CREATE ROLE ops_script   LOGIN PASSWORD 'ops_script';   -- script sửa dữ liệu của đội vận hành
CREATE ROLE dba_lan      LOGIN PASSWORD 'dba_lan';      -- tài khoản cá nhân của DBA, sửa trực tiếp bằng psql

CREATE SCHEMA truoc;
SET search_path = truoc;
\i /lab/db/schema-before.sql

-- Phương án so sánh ở mục 2 README: ứng dụng tự ghi nhật ký trong repository (chỉ có ở schema truoc).
CREATE TABLE truoc.app_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  action      text   NOT NULL,
  old_row     jsonb,
  new_row     jsonb,
  changed_by  text   NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

SET search_path = public;
\i /lab/db/schema-before.sql
RESET search_path;

GRANT USAGE ON SCHEMA truoc TO contract_app, ops_script, dba_lan;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA truoc TO contract_app, dba_lan;
GRANT SELECT, UPDATE ON truoc.contracts TO ops_script;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA truoc TO contract_app, dba_lan;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts, public.claims TO contract_app, dba_lan;
GRANT SELECT, UPDATE ON public.contracts TO ops_script;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO contract_app, dba_lan;
