-- File không ghi tên schema: nạp được vào cả `public` (init) lẫn `lab_test` (test) qua search_path (nhật ký 01/02 điểm 2).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,         -- scrypt (lab không về băm mật khẩu; xem bài 19/01 cho Argon2id)
  locked        boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,            -- lưu NGUYÊN HTML (cố ý không sanitize) để tái hiện stored XSS trong lab
  created_at timestamptz NOT NULL DEFAULT now()
);
