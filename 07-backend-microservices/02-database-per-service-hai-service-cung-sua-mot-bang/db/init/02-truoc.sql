-- Trước: 5 bảng dùng chung, cả hai service đều có quyền ghi "cho tiện". Hợp đồng giữa hai đội chính là cấu trúc các bảng này.
-- Chạy lại được: test gọi file này để đưa bản "trước" về nguyên trạng.
DROP SCHEMA IF EXISTS shared CASCADE;
CREATE SCHEMA shared;

CREATE TABLE shared.shops (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE shared.orders (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shared.shops (id),
  address text NOT NULL,
  delivery_window text NOT NULL,
  zone_code text NOT NULL,
  total_vnd bigint NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared.order_items (
  order_id uuid NOT NULL REFERENCES shared.orders (id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE shared.order_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES shared.orders (id),
  status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared.delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES shared.orders (id),
  outcome text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON shared.delivery_attempts (order_id);

GRANT USAGE ON SCHEMA shared TO truoc_order, truoc_shipping;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared TO truoc_order, truoc_shipping;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared TO truoc_order, truoc_shipping;
