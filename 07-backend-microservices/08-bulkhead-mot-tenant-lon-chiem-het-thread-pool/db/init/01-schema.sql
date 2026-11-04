CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('exports');

CREATE ROLE crm_app LOGIN PASSWORD 'crm_app';
CREATE SCHEMA crm AUTHORIZATION crm_app;

CREATE TABLE crm.deals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  amount_vnd bigint NOT NULL
);
CREATE INDEX ON crm.deals (tenant_id);

CREATE TABLE crm.notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.exports (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  status text NOT NULL
);

ALTER TABLE crm.deals OWNER TO crm_app;
ALTER TABLE crm.notes OWNER TO crm_app;
ALTER TABLE crm.exports OWNER TO crm_app;

GRANT USAGE ON SCHEMA pgmq TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmq TO crm_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO crm_app;

-- 300 tenant, T-1 là khách lớn chiếm khoảng 35 % dữ liệu.
INSERT INTO crm.deals (tenant_id, amount_vnd)
SELECT 'T-1', 1000000 + n FROM generate_series(1, 35000) AS n;
INSERT INTO crm.deals (tenant_id, amount_vnd)
SELECT format('T-%s', n % 299 + 2), 1000000 + n FROM generate_series(1, 65000) AS n;
