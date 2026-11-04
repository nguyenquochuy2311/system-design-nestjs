-- Trước: một schema, mỗi entity service quản một bảng lớn nhất của nó.
CREATE ROLE truoc_app LOGIN PASSWORD 'truoc_app';
CREATE SCHEMA truoc;

CREATE TABLE truoc.users (
  id text PRIMARY KEY,
  active boolean NOT NULL
);

CREATE TABLE truoc.products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  image_url text NOT NULL,
  category text NOT NULL,
  price_vnd bigint NOT NULL
);

CREATE TABLE truoc.stock (
  sku text PRIMARY KEY,
  on_hand integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0
);

CREATE TABLE truoc.promotions (
  code text PRIMARY KEY,
  percent_off integer NOT NULL
);

CREATE TABLE truoc.payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  amount_vnd bigint NOT NULL,
  status text NOT NULL
);

CREATE TABLE truoc.orders (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  status text NOT NULL,
  total_vnd bigint NOT NULL,
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA truoc TO truoc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA truoc TO truoc_app;

-- Sau: mỗi context một schema và một role. Không role nào có USAGE trên schema của context khác, nên đọc chéo là lỗi
-- quyền ngay ở database, không dựa vào kỷ luật người viết code.
CREATE ROLE catalog_app LOGIN PASSWORD 'catalog_app';
CREATE ROLE ordering_app LOGIN PASSWORD 'ordering_app';
CREATE ROLE inventory_app LOGIN PASSWORD 'inventory_app';
CREATE ROLE payment_app LOGIN PASSWORD 'payment_app';

CREATE SCHEMA catalog;
CREATE SCHEMA ordering;
CREATE SCHEMA inventory;
CREATE SCHEMA payment;

-- "Sản phẩm" theo Catalog: mô tả, ảnh, danh mục, giá niêm yết.
CREATE TABLE catalog.products (
  sku text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  image_url text NOT NULL,
  category text NOT NULL,
  list_price_vnd bigint NOT NULL,
  price_version integer NOT NULL DEFAULT 1
);

CREATE TABLE ordering.customers (
  id text PRIMARY KEY,
  active boolean NOT NULL
);

CREATE TABLE ordering.promotions (
  code text PRIMARY KEY,
  percent_off integer NOT NULL
);

-- "Sản phẩm" theo Ordering: chỉ tên và giá đủ để bán. Đây là bản sao có chủ đích, cập nhật bằng sự kiện từ Catalog.
CREATE TABLE ordering.product_snapshots (
  sku text PRIMARY KEY,
  product_name text NOT NULL,
  unit_price_vnd bigint NOT NULL,
  price_version integer NOT NULL
);

CREATE TABLE ordering.orders (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES ordering.customers (id),
  status text NOT NULL,
  total_vnd bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tên và giá chép vào dòng hàng tại lúc mua: Catalog đổi gì sau đó cũng không đụng tới đơn đã đặt.
CREATE TABLE ordering.order_lines (
  order_id uuid NOT NULL REFERENCES ordering.orders (id),
  sku text NOT NULL,
  product_name text NOT NULL,
  unit_price_vnd bigint NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (order_id, sku)
);

-- Sự kiện lớp dịch không hiểu: giữ lại để đội Ordering đọc, không chặn các sự kiện sau.
CREATE TABLE ordering.quarantined_events (
  msg_id bigint PRIMARY KEY,
  reason text NOT NULL,
  payload jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);

-- "Sản phẩm" theo Inventory: SKU và số lượng.
CREATE TABLE inventory.stock_items (
  sku text PRIMARY KEY,
  on_hand integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0
);

CREATE TABLE inventory.reservations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE payment.transactions (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  amount_vnd bigint NOT NULL,
  status text NOT NULL
);

GRANT USAGE ON SCHEMA catalog TO catalog_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO catalog_app;
GRANT USAGE ON SCHEMA ordering TO ordering_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ordering TO ordering_app;
GRANT USAGE ON SCHEMA inventory TO inventory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO inventory_app;
GRANT USAGE ON SCHEMA payment TO payment_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payment TO payment_app;

-- Hai context dùng hàng đợi: Catalog gửi, Ordering đọc. Inventory và Payment không có quyền này.
GRANT USAGE ON SCHEMA pgmq TO catalog_app, ordering_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO catalog_app, ordering_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmq TO catalog_app, ordering_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO catalog_app, ordering_app;
