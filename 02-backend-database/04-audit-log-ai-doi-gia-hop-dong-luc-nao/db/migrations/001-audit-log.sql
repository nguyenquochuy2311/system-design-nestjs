-- [PATTERN] Audit Log (Fowler, eaaDev): mỗi khi hợp đồng bị thêm, sửa hay xóa, database tự ghi một dòng
-- "bảng nào, dòng nào, hành động gì, bản cũ, bản mới, ai, vì sao, lúc nào" vào audit.audit_log.
-- Đặt ở trigger chứ không ở code ứng dụng để bắt MỌI đường ghi: API, job, script, psql của DBA.
-- Chạy bằng superuser postgres (pnpm db:migrate, hoặc tự động trong globalSetup của test). Chạy lại được.
-- Không dùng lệnh psql (\...) để file chạy được cả bằng psql lẫn bằng node-postgres.
BEGIN;

DO $$
BEGIN
  -- Chủ sở hữu nhật ký: không đăng nhập được, không ai "là" nó trong công việc hằng ngày.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_owner') THEN
    CREATE ROLE audit_owner NOLOGIN;
  END IF;
  -- Role đánh dấu: tài khoản là thành viên thì BẮT BUỘC đặt app.user_id trước khi ghi (xem log_change).
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'actor_required') THEN
    CREATE ROLE actor_required NOLOGIN;
  END IF;
END $$;
GRANT actor_required TO contract_app;

CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION audit_owner;

CREATE TABLE IF NOT EXISTS audit.audit_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name     text        NOT NULL,
  row_id         bigint      NOT NULL,
  action         text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE', 'RESTORE')),
  old_row        jsonb,                -- NULL với INSERT
  new_row        jsonb,                -- NULL với DELETE
  changed_fields text[],               -- tên cột đã đổi, chỉ có với UPDATE / SOFT_DELETE / RESTORE
  actor          text        NOT NULL, -- app.user_id; đường ghi không đặt thì 'db:<tài khoản DB>'
  db_user        text        NOT NULL, -- session_user: tài khoản DB thật sự chạy câu lệnh
  reason         text,
  request_id     text,
  txid           bigint      NOT NULL, -- gom các thay đổi của cùng một transaction
  changed_at     timestamptz NOT NULL  -- now() = thời điểm transaction bắt đầu
);
ALTER TABLE audit.audit_log OWNER TO audit_owner;
-- Câu hỏi của kiểm toán luôn là "dòng X của bảng Y đã đổi thế nào theo thời gian".
CREATE INDEX IF NOT EXISTS audit_log_row_idx ON audit.audit_log (table_name, row_id, changed_at);

CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql
-- [PATTERN] Chạy với quyền của chủ hàm (audit_owner): tài khoản ứng dụng không cần, và không có, quyền INSERT
-- vào nhật ký, nên cũng không tự chèn được dòng nhật ký giả.
SECURITY DEFINER
-- Bắt buộc khi dùng SECURITY DEFINER (PostgreSQL docs, "Writing SECURITY DEFINER Functions Safely").
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row_id  bigint;
  v_user    text  := nullif(current_setting('app.user_id', true), '');
  v_action  text  := TG_OP;
  v_changed text[];
BEGIN
  -- [PATTERN] Người thực hiện do ứng dụng truyền vào bằng set_config('app.user_id', ..., true) trong transaction ghi.
  -- Tài khoản ứng dụng mà quên đặt thì từ chối ghi: thà lỗi còn hơn một dòng nhật ký không biết ai.
  -- Tài khoản khác (script, DBA) quên đặt thì vẫn ghi, người thực hiện là tên tài khoản DB.
  IF v_user IS NULL AND pg_has_role(session_user, 'actor_required', 'MEMBER') THEN
    RAISE EXCEPTION 'audit: tài khoản % phải đặt app.user_id trước khi ghi bảng %', session_user, TG_TABLE_NAME
      USING HINT = 'Ghi qua withActor(...) trong src/sau/with-actor.ts';
  END IF;

  v_row_id := (coalesce(v_new, v_old) ->> 'id')::bigint;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
    FROM jsonb_each(v_new) AS n
    WHERE n.value IS DISTINCT FROM v_old -> n.key;
    IF v_changed IS NULL THEN
      RETURN NULL; -- UPDATE không đổi giá trị nào: không có gì để ghi
    END IF;
    IF v_old ->> 'deleted_at' IS NULL AND v_new ->> 'deleted_at' IS NOT NULL THEN
      v_action := 'SOFT_DELETE';
    ELSIF v_old ->> 'deleted_at' IS NOT NULL AND v_new ->> 'deleted_at' IS NULL THEN
      v_action := 'RESTORE';
    END IF;
    -- Tham số 'diff' (tùy chọn): chỉ giữ các trường đã đổi để tiết kiệm dung lượng (đo ở bench/audit-storage.ts).
    IF TG_ARGV[0] = 'diff' THEN
      SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) INTO v_old, v_new
      FROM unnest(v_changed) AS k;
    END IF;
  END IF;

  INSERT INTO audit.audit_log
    (table_name, row_id, action, old_row, new_row, changed_fields, actor, db_user, reason, request_id, txid, changed_at)
  VALUES
    (TG_TABLE_NAME, v_row_id, v_action, v_old, v_new, v_changed,
     coalesce(v_user, 'db:' || session_user), session_user,
     nullif(current_setting('app.reason', true), ''), nullif(current_setting('app.request_id', true), ''),
     txid_current(), now());
  RETURN NULL; -- trigger AFTER: giá trị trả về bị bỏ qua
END;
$$;
ALTER FUNCTION audit.log_change() OWNER TO audit_owner;

-- Một hàm dùng chung cho nhiều bảng được theo dõi.
CREATE OR REPLACE TRIGGER contracts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('full');
CREATE OR REPLACE TRIGGER claims_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('full');

-- [PATTERN] Nhật ký chỉ thêm. Lớp 1 là quyền: ứng dụng, script, DBA chỉ được SELECT (hoặc không gì cả).
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO contract_app, dba_lan;
REVOKE ALL ON audit.audit_log FROM PUBLIC, contract_app, ops_script, dba_lan;
GRANT SELECT ON audit.audit_log TO contract_app, dba_lan;

-- Lớp 2: kể cả chủ bảng hay superuser lỡ tay UPDATE / DELETE / TRUNCATE cũng bị chặn. Muốn qua phải chủ động
-- tắt trigger bằng ALTER TABLE (chỉ chủ bảng hoặc superuser làm được) — giới hạn này ghi ở mục 6 README.
CREATE OR REPLACE FUNCTION audit.reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log chỉ cho phép thêm: % bị từ chối (tài khoản %)', TG_OP, session_user;
END;
$$;
ALTER FUNCTION audit.reject_change() OWNER TO audit_owner;
CREATE OR REPLACE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

COMMIT;
