-- pnpm db:migrate: áp dụng pattern lên bảng public.contracts đang có dữ liệu, in thời gian từng bước.
\set ON_ERROR_STOP on
\timing on
\i /lab/db/migrations/001-audit-log.sql
\i /lab/db/migrations/002-soft-delete.sql
\timing off
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('contracts_audit', 'claims_audit', 'audit_log_append_only') ORDER BY tgname;
