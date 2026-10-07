-- Schema dùng chung cho bản "trước" và "sau": bài này đổi cấu trúc code, không đổi database.
-- Tiền tính bằng đồng (VND), kiểu bigint; công nợ = tổng các đơn chưa thanh toán.
CREATE TABLE customers (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('standard', 'silver', 'gold', 'diamond')),
  credit_limit bigint NOT NULL CHECK (credit_limit >= 0)
);

CREATE TABLE products (
  id bigserial PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  unit_price bigint NOT NULL CHECK (unit_price > 0),
  is_promo boolean NOT NULL DEFAULT false -- hàng khuyến mãi đã giảm giá sẵn, không cộng chiết khấu hạng
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers (id),
  channel text NOT NULL CHECK (channel IN ('web', 'csv', 'marketplace')),
  external_ref text,
  subtotal bigint NOT NULL,
  discount bigint NOT NULL,
  total bigint NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_unpaid_idx ON orders (customer_id) WHERE status = 'unpaid';

CREATE TABLE order_items (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  product_id bigint NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price bigint NOT NULL,
  line_total bigint NOT NULL
);
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
