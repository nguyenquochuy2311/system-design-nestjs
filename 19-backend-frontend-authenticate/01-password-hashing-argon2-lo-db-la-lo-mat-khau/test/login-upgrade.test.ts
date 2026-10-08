import { parseOptions } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { md5Hex } from '../src/shared/md5';
import { PasswordHasher } from '../src/sau/password-hasher';
import { wrapLegacyHashes } from '../src/sau/wrap-legacy-migration';
import {
  countWithMd5,
  insertMd5User,
  insertWrappedUser,
  setupTestDb,
  startTestApp,
  TEST_PEPPER,
  TEST_SCHEMA,
  userById,
  type TestApp,
} from './support/test-app';

describe('Đăng nhập và nâng cấp hash', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp(await setupTestDb());
  });
  afterAll(() => t.close());

  it('bản trước (MD5 không salt): hai user cùng mật khẩu có CÙNG password_md5', async () => {
    await insertMd5User(t.db, 'a@lab.example', 'matkhau-chung');
    await insertMd5User(t.db, 'b@lab.example', 'matkhau-chung');
    const rows = await t.db.selectFrom('users').select('password_md5').where('email', 'in', ['a@lab.example', 'b@lab.example']).execute();
    expect(rows[0]!.password_md5).toBe(rows[1]!.password_md5); // triệu chứng: lộ một là lộ cả nhóm
    // /truoc/login vẫn đăng nhập được bằng cách so MD5.
    expect((await t.login('/truoc/login', 'a@lab.example', 'matkhau-chung')).status).toBe(200);
    expect((await t.login('/truoc/login', 'a@lab.example', 'sai')).status).toBe(401);
  });

  it('hash cũ đã bọc (version 1) đăng nhập đúng → hash_version thành 2, password_hash verify TRỰC TIẾP được', async () => {
    const id = await insertWrappedUser(t, 'wrap@lab.example', 'MậtKhẩuThật#1');
    const before = await userById(t.db, id);
    expect(before.hash_version).toBe(1);

    const res = await t.login('/sau/login', 'wrap@lab.example', 'MậtKhẩuThật#1');
    expect(res.status).toBe(200);
    expect(res.body.upgraded).toBe(true);
    expect(res.body.hashVersion).toBe(2);

    const after = await userById(t.db, id);
    expect(after.hash_version).toBe(2);
    expect(after.password_hash).not.toBe(before.password_hash);
    // MD5 đã xóa từ lúc migration (version 1) và vẫn NULL sau khi lên version 2.
    expect(before.password_md5).toBeNull();
    expect(after.password_md5).toBeNull();
    // Hash mới verify thẳng mật khẩu thật (không còn qua md5), và KHÔNG verify được chuỗi md5.
    expect(await t.hasher.verify(after.password_hash!, 'MậtKhẩuThật#1')).toBe(true);
    expect(await t.hasher.verify(after.password_hash!, md5Hex('MậtKhẩuThật#1'))).toBe(false);
  });

  it('hash cũ đã bọc, SAI mật khẩu → 401; không nâng cấp', async () => {
    const id = await insertWrappedUser(t, 'wrong@lab.example', 'đúng-mk');
    expect((await t.login('/sau/login', 'wrong@lab.example', 'sai-mk')).status).toBe(401);
    expect((await userById(t.db, id)).hash_version).toBe(1); // vẫn chưa nâng cấp
  });

  it('email không tồn tại → 401 giống hệt sai mật khẩu (không lộ danh sách tài khoản)', async () => {
    const res = await t.login('/sau/login', 'khong-co@lab.example', 'bất-kỳ');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('version 2 với tham số THẤP: đăng nhập đúng thì băm lại theo tham số hiện hành (needsRehash)', async () => {
    // Mở app thứ hai (pool riêng, cùng schema) với tham số cao hơn (m=19456) để chứng minh nâng cấp tại chỗ.
    // Pool riêng vì app.close() sẽ destroy pool KYSELY của nó — không được đụng t.db.
    const db2 = createDb({ schema: TEST_SCHEMA, max: 10 });
    const app = await startTestApp(db2, { hasher: { memoryCost: 19456, timeCost: 2 } });
    try {
      // Hash version 2 được tạo với tham số thấp (m=8192) — thấp hơn tham số hiện hành của app.
      const yeu = new PasswordHasher({ memoryCost: 8192, timeCost: 1, parallelism: 1, pepper: TEST_PEPPER });
      const phcYeu = await yeu.hash('mk-v2');
      const row = await t.db
        .insertInto('users')
        .values({ email: 'v2@lab.example', password_md5: md5Hex('mk-v2'), password_hash: phcYeu, hash_version: 2 })
        .returning('id')
        .executeTakeFirstOrThrow();

      const res = await app.login('/sau/login', 'v2@lab.example', 'mk-v2');
      expect(res.status).toBe(200);
      expect(res.body.upgraded).toBe(true);
      const after = await userById(t.db, row.id);
      expect(after.hash_version).toBe(2);
      expect(parseOptions(after.password_hash!).memoryCost).toBe(19456); // đã băm lại theo tham số cao hơn
    } finally {
      await app.close();
    }
  });
});
