import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wrapLegacyHashes } from '../src/sau/wrap-legacy-migration';
import { countWithMd5, insertMd5User, setupTestDb, startTestApp, userById, type TestApp } from './support/test-app';

// Lộ DB sau khi "đã áp pattern" KHÔNG được là lộ mật khẩu rõ: cột MD5 phải biến mất sau migration và sau
// mỗi lần nâng cấp khi đăng nhập. (Lỗi gặp thật: trước khi sửa, migration giữ nguyên password_md5.)
describe('Migration bọc hash phải xóa MD5', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb());
  });
  afterAll(() => t.close());

  it('sau wrapLegacyHashes: mọi dòng lên version 1, có password_hash, và KHÔNG còn password_md5', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await insertMd5User(t.db, `m${i}@lab.example`, `mk-${i}-2026`));
    expect(await countWithMd5(t.db)).toBe(5); // trước migration: còn MD5

    const n = await wrapLegacyHashes(t.db, t.hasher, { concurrency: 4 });
    expect(n).toBe(5);
    expect(await countWithMd5(t.db)).toBe(0); // sau migration: không còn MD5 trong bản dump

    for (const id of ids) {
      const u = await userById(t.db, id);
      expect(u.hash_version).toBe(1);
      expect(u.password_hash).not.toBeNull();
      expect(u.password_md5).toBeNull();
    }
  });

  it('đăng nhập đúng (user version 0 chưa di trú) → lên version 2 và xóa MD5', async () => {
    const id = await insertMd5User(t.db, 'v0@lab.example', 'MậtKhẩu-v0');
    expect((await userById(t.db, id)).password_md5).not.toBeNull();

    const res = await t.login('/sau/login', 'v0@lab.example', 'MậtKhẩu-v0');
    expect(res.status).toBe(200);
    expect(res.body.upgraded).toBe(true);
    expect(res.body.hashVersion).toBe(2);

    const after = await userById(t.db, id);
    expect(after.hash_version).toBe(2);
    expect(after.password_hash).not.toBeNull();
    expect(after.password_md5).toBeNull(); // MD5 bị xóa khi nâng cấp
  });
});
