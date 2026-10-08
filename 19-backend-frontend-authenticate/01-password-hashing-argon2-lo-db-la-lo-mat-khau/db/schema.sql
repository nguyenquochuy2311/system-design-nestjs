-- Schema dùng chung cho database chính (public) và schema test `lab_test`: không ghi tên schema (nhật ký 01/02 điểm 2).
-- Một bảng users giữ cả cách cũ và cách mới để chạy song song "trước" và "sau" trên cùng dữ liệu:
--   password_md5  : MD5(mật khẩu) không salt — cách lưu cũ. NULL được: migration và nâng cấp khi đăng nhập
--                   phải XÓA cột này (đặt NULL) cùng lúc bọc/băm lại, nếu không dump vẫn lộ mật khẩu rõ.
--   password_hash : chuỗi PHC Argon2id (NULL khi chưa di trú).
--   hash_version  : 0 = chỉ còn MD5 (chưa di trú) · 1 = argon2id(md5) đã bọc · 2 = argon2id(mật khẩu) trực tiếp.

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  -- MD5 hex 32 ký tự, không salt: hai người cùng mật khẩu có cùng chuỗi này (điểm yếu của cách cũ).
  -- NULL sau khi đã di trú: không được giữ lại MD5 bên cạnh hash mới (xem comment ở trên).
  password_md5 text,
  -- [PATTERN] chuỗi PHC mang thuật toán + tham số + salt riêng từng người: $argon2id$v=19$m=..,t=..,p=..$salt$hash
  password_hash text,
  -- [PATTERN] cho biết tài khoản nào còn hash cũ, để nâng cấp dần và đo tiến độ di trú bằng một câu SQL.
  hash_version smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
