-- Chạy bằng role order_rw. Bảng do role này sở hữu; không cấp gì cho role khác.
CREATE TABLE ordering.shops (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE ordering.orders (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES ordering.shops (id),
  address text NOT NULL,
  delivery_window text NOT NULL,
  zone_code text NOT NULL,
  total_vnd bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ordering.order_items (
  order_id uuid NOT NULL REFERENCES ordering.orders (id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (order_id, sku)
);
