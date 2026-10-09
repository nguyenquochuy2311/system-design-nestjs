-- [PATTERN] Tạo role và quyền GIỐNG production ngay trong môi trường dev/CI, để lỗi quyền lộ ra ở máy dev chứ không
-- phải lúc phát hành. Image postgres chạy file *.sql trong /docker-entrypoint-initdb.d đúng một lần, khi thư mục dữ
-- liệu còn trống, bằng POSTGRES_USER (superuser khởi tạo, giống tài khoản master của DB được quản lý) và nối vào
-- POSTGRES_DB. Muốn chạy lại: `docker compose down -v` rồi `up`. Các lệnh dưới vẫn viết idempotent.
--
-- Hai role như production:
--   app_owner: owner của database (nên là owner của schema public, PostgreSQL 15+), chạy migration (DDL).
--   app_user : ứng dụng; chỉ CONNECT, USAGE trên public và SELECT/INSERT/UPDATE/DELETE trên bảng do owner tạo.
--
-- `\getenv` có từ psql 15: file này cố ý chỉ dành cho image PostgreSQL ≥ 15 (compose ghim 16.15).

\set ON_ERROR_STOP on
\getenv owner_password APP_OWNER_PASSWORD
\getenv app_password APP_USER_PASSWORD
\getenv dev_db POSTGRES_DB

\if :{?owner_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'Thiếu biến môi trường APP_OWNER_PASSWORD'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'Thiếu biến môi trường APP_USER_PASSWORD'; END $$;
\endif

-- Mật khẩu đi qua format(%L), không nối chuỗi tay. Role là đối tượng của cả cluster, tạo một lần.
SELECT format('CREATE ROLE app_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \gexec
SELECT format('CREATE ROLE app_user LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') \gexec

-- Database cho test: cùng cấu hình quyền với database dev, để test kiểm đúng thứ production có.
\set test_db :dev_db _test
SELECT format('CREATE DATABASE %I', :'test_db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'test_db') \gexec

-- File .psql không bị entrypoint tự chạy (chỉ *.sh, *.sql...), nên dùng chung được cho cả hai database.
\set target_db :dev_db
\ir app-privileges.psql
\set target_db :test_db
\ir app-privileges.psql
