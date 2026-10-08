/**
 * Seed 10.000 user theo CÁCH CŨ: password_md5 = MD5(mật khẩu) không salt, hash_version = 0.
 * Mật khẩu là dữ liệu TỔNG HỢP sinh deterministic từ từ điển (bench/lib/dictionary.ts); KHÔNG ghi ra file,
 * sinh lại được bằng chính script này. Chạy: pnpm db:seed   (cần pnpm db:up)
 */
import { createDb } from '../src/shared/db';
import { md5Hex } from '../src/shared/md5';
import { assignSeedPasswords, generateDictionary } from '../bench/lib/dictionary';

const COUNT = Number(process.env.SEED_COUNT ?? 10_000);

const db = createDb({ max: 1 });
try {
  const dict = generateDictionary();
  const users = assignSeedPasswords(COUNT, dict);
  await db.deleteFrom('users').execute();
  // Chèn theo lô để không vượt giới hạn tham số của một câu INSERT.
  const batch = 1000;
  for (let i = 0; i < users.length; i += batch) {
    await db
      .insertInto('users')
      .values(
        users.slice(i, i + batch).map((u) => ({
          email: u.email,
          password_md5: md5Hex(u.password),
          hash_version: 0,
        })),
      )
      .execute();
  }
  const total = await db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
  const inDict = users.filter((u) => u.inDict).length;
  console.log(
    `Đã seed ${total.n} user (MD5 không salt, hash_version=0). ` +
      `${inDict}/${users.length} (${((inDict / users.length) * 100).toFixed(1)}%) có mật khẩu trong từ điển tổng hợp (giả định phân phối, minh họa).`,
  );
} finally {
  await db.destroy();
}
