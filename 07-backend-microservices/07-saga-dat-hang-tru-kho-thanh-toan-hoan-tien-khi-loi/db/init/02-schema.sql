CREATE SCHEMA ordering AUTHORIZATION order_rw;
CREATE SCHEMA inventory AUTHORIZATION inventory_rw;
CREATE SCHEMA payment AUTHORIZATION payment_rw;
CREATE SCHEMA truoc AUTHORIZATION truoc_rw;

CREATE TABLE ordering.orders (
  id uuid PRIMARY KEY,
  sku text NOT NULL,
  quantity integer NOT NULL,
  amount_vnd bigint NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- [PATTERN] Nơi bền vững ghi nhớ quy trình đã tới đâu; một câu SQL trả lời "đơn X đang ở đâu".
CREATE TABLE ordering.order_sagas (
  saga_id uuid PRIMARY KEY REFERENCES ordering.orders (id),
  state text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ordering.order_saga_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  saga_id uuid NOT NULL REFERENCES ordering.order_sagas (saga_id),
  from_state text,
  to_state text NOT NULL,
  event text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON ordering.order_saga_transitions (saga_id);

CREATE TABLE inventory.stock_items (
  sku text PRIMARY KEY,
  on_hand integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0
);

-- Một dòng cho mỗi saga: khóa chống trùng của bước giữ hàng và bước bù. RELEASED không có hàng là tombstone.
CREATE TABLE inventory.reservations (
  saga_id uuid PRIMARY KEY,
  sku text NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL
);

CREATE TABLE payment.payments (
  saga_id uuid PRIMARY KEY,
  status text NOT NULL,
  amount_vnd bigint NOT NULL
);

CREATE TABLE truoc.orders (
  id uuid PRIMARY KEY,
  sku text NOT NULL,
  quantity integer NOT NULL,
  amount_vnd bigint NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE truoc.stock_items (
  sku text PRIMARY KEY,
  on_hand integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0
);

CREATE TABLE truoc.reservations (
  order_id uuid PRIMARY KEY,
  sku text NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL
);

ALTER TABLE ordering.orders OWNER TO order_rw;
ALTER TABLE ordering.order_sagas OWNER TO order_rw;
ALTER TABLE ordering.order_saga_transitions OWNER TO order_rw;
ALTER TABLE inventory.stock_items OWNER TO inventory_rw;
ALTER TABLE inventory.reservations OWNER TO inventory_rw;
ALTER TABLE payment.payments OWNER TO payment_rw;
ALTER TABLE truoc.orders OWNER TO truoc_rw;
ALTER TABLE truoc.stock_items OWNER TO truoc_rw;
ALTER TABLE truoc.reservations OWNER TO truoc_rw;
