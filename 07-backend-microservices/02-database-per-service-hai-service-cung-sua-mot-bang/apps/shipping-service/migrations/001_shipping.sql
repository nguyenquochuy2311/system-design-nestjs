-- Chạy bằng role shipping_rw.
-- [PATTERN] Bản sao chỉ có trường shipping cần để vận hành: không có giá, không có dòng hàng, không có shop.
CREATE TABLE shipping.shipment_orders (
  order_id uuid PRIMARY KEY,
  address text NOT NULL,
  delivery_window text NOT NULL,
  zone_code text NOT NULL,
  order_version integer NOT NULL,
  event_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replicated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE shipping.delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES shipping.shipment_orders (order_id),
  outcome text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON shipping.delivery_attempts (order_id);

-- Sự kiện không dịch được: giữ lại để đội shipping đọc, không chặn các sự kiện sau.
CREATE TABLE shipping.quarantined_events (
  msg_id bigint PRIMARY KEY,
  reason text NOT NULL,
  payload jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);
