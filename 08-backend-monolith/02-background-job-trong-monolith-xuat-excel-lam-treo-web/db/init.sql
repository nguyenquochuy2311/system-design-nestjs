-- Schema của lab 08/02. Chạy một lần khi tạo volume (docker-entrypoint-initdb.d).
CREATE EXTENSION IF NOT EXISTS pgmq; -- PGMQ 1.13.0 có sẵn trong image ghcr.io/pgmq/pg16-pgmq

CREATE TABLE tenants (
  id   serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE users (
  id        serial PRIMARY KEY,
  tenant_id int  NOT NULL REFERENCES tenants (id),
  name      text NOT NULL,
  role      text NOT NULL
);

CREATE TABLE orders (
  id             bigserial PRIMARY KEY,
  tenant_id      int         NOT NULL REFERENCES tenants (id),
  code           text        NOT NULL,
  store_name     text        NOT NULL,
  customer_name  text        NOT NULL,
  customer_phone text        NOT NULL,
  status         text        NOT NULL,
  item_count     int         NOT NULL,
  subtotal       bigint      NOT NULL,
  discount       bigint      NOT NULL,
  total          bigint      NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Báo cáo tháng đọc theo (tenant, khoảng thời gian) và sắp theo created_at, id
CREATE INDEX orders_tenant_created_idx ON orders (tenant_id, created_at, id);

CREATE TABLE export_jobs (
  id           bigserial PRIMARY KEY,
  tenant_id    int         NOT NULL REFERENCES tenants (id),
  requested_by int         NOT NULL REFERENCES users (id),
  filter       jsonb       NOT NULL,
  filter_hash  text        NOT NULL,
  status       text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts     int         NOT NULL DEFAULT 0,  -- bằng read_ct của message PGMQ ở lần nhận gần nhất
  rows_written int         NOT NULL DEFAULT 0,  -- tiến độ cho kế toán xem
  row_count    int,
  object_key   text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
-- [PATTERN] chặn job trùng: một người + một bộ lọc chỉ có một job đang chờ hoặc đang chạy
CREATE UNIQUE INDEX export_jobs_active_uniq ON export_jobs (requested_by, filter_hash) WHERE status IN ('queued', 'running');

SELECT pgmq.create('exports');
