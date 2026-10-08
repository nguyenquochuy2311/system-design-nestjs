-- Schema dùng chung cho database chính (public) và schema test `lab_test`: không ghi tên schema (nhật ký 01/02 điểm 2).

-- Ví: số dư tính bằng đồng, không bao giờ âm.
CREATE TABLE wallets (
  user_id bigint PRIMARY KEY,
  balance bigint NOT NULL CHECK (balance >= 0)
);

-- Giao dịch thanh toán. `note` là mã ý định do client gửi (chỉ để đối soát trong lab, không ràng buộc gì).
CREATE TABLE payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES wallets (user_id),
  merchant_id integer NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- [PATTERN] Khóa idempotency: một dòng cho mỗi (người dùng, khóa). Khóa chính là ràng buộc duy nhất giúp phát hiện
-- request trùng một cách nguyên tử (INSERT ... ON CONFLICT DO NOTHING).
CREATE TABLE idempotency_keys (
  user_id bigint NOT NULL,
  idempotency_key text NOT NULL,
  request_method text NOT NULL,
  request_path text NOT NULL,
  -- SHA-256 của method + path + body đã chuẩn hóa thứ tự khóa.
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  -- Thời điểm một request nhận xử lý khóa; NULL khi đã xong. Khóa kẹt quá lâu được tiếp quản.
  locked_at timestamptz,
  response_code integer,
  -- text, không phải jsonb: jsonb sắp lại thứ tự khóa và khoảng trắng, response phát lại sẽ khác byte lần đầu.
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, idempotency_key)
);

-- Cho job dọn khóa quá hạn.
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);
