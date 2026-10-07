import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL, DBA_URL } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { connect, createTestContract, settle, sqlState } from './helpers';

const db = createDb();
let app: pg.Client;
let dba: pg.Client;
let admin: pg.Client;
let contractId: number;

const PERMISSION_DENIED = '42501';

beforeAll(async () => {
  app = await connect(APP_URL, 'app');
  dba = await connect(DBA_URL, 'dba');
  admin = await connect(ADMIN_URL, 'admin');
  contractId = (await createTestContract(db, 'sau')).id; // có ít nhất một dòng nhật ký (INSERT) để thử sửa
});
afterAll(async () => {
  await Promise.all([app.end(), dba.end(), admin.end(), db.destroy()]);
});

describe('nhật ký chỉ thêm: tài khoản ứng dụng không sửa, không xóa, không giả mạo được', () => {
  it('ứng dụng UPDATE, DELETE, TRUNCATE nhật ký đều bị từ chối: permission denied (42501)', async () => {
    expect(await sqlState(app.query("UPDATE audit.audit_log SET actor = 'người khác' WHERE row_id = $1", [contractId]))).toBe(PERMISSION_DENIED);
    expect(await sqlState(app.query('DELETE FROM audit.audit_log WHERE row_id = $1', [contractId]))).toBe(PERMISSION_DENIED);
    expect(await sqlState(app.query('TRUNCATE audit.audit_log'))).toBe(PERMISSION_DENIED);
  });

  it('ứng dụng cũng không chèn được dòng nhật ký giả: chỉ trigger (SECURITY DEFINER) ghi được', async () => {
    const fake = app.query(
      "INSERT INTO audit.audit_log (table_name, row_id, action, actor, db_user, txid, changed_at) VALUES ('contracts', $1, 'UPDATE', 'nv-gia', 'contract_app', 0, now())",
      [contractId],
    );
    expect(await sqlState(fake)).toBe(PERMISSION_DENIED);
  });

  it('ứng dụng không tắt được trigger nhật ký để ghi lén: phải là chủ bảng', async () => {
    expect(await sqlState(app.query('ALTER TABLE contracts DISABLE TRIGGER contracts_audit'))).toBe(PERMISSION_DENIED);
  });

  it('DBA dùng tài khoản cá nhân đọc được nhật ký nhưng không sửa được', async () => {
    const { rows } = await dba.query('SELECT count(*)::int AS n FROM audit.audit_log WHERE row_id = $1', [contractId]);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(await sqlState(dba.query("UPDATE audit.audit_log SET reason = 'sửa lại' WHERE row_id = $1", [contractId]))).toBe(PERMISSION_DENIED);
  });

  it('kể cả superuser lỡ tay UPDATE / DELETE / TRUNCATE cũng bị trigger chặn, nhật ký không đổi', async () => {
    const count = async () => (await admin.query('SELECT count(*)::int AS n FROM audit.audit_log WHERE row_id = $1', [contractId])).rows[0].n as number;
    const before = await count();
    for (const statement of [
      `UPDATE audit.audit_log SET actor = 'x' WHERE row_id = ${contractId}`,
      `DELETE FROM audit.audit_log WHERE row_id = ${contractId}`,
      'TRUNCATE audit.audit_log',
    ]) {
      const r = await settle(admin.query(statement));
      expect(r.ok).toBe(false);
      expect((r as { error: Error }).error.message).toMatch(/chỉ cho phép thêm/);
    }
    expect(await count()).toBe(before);
  });

  it('ứng dụng vẫn đọc được nhật ký để trả lời kiểm toán', async () => {
    const { rows } = await app.query("SELECT action, actor FROM audit.audit_log WHERE table_name = 'contracts' AND row_id = $1", [contractId]);
    expect(rows[0]).toEqual({ action: 'INSERT', actor: 'nv-ban-hang' });
  });
});
