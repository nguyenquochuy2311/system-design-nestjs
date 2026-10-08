/**
 * [PATTERN] Migration một lần: bọc toàn bộ hash MD5 thành argon2id(md5) VÀ xóa cột MD5 (password_md5 → NULL)
 * trong cùng câu UPDATE — đóng lỗ hổng ngay mà không cần biết mật khẩu gốc, và không để dump còn MD5 rõ.
 * Logic ở src/sau/wrap-legacy-migration.ts (dùng chung với test). Chạy theo lô, tiếp tục được khi gián đoạn.
 * Chạy: pnpm migrate:wrap   (cần pnpm db:up và PASSWORD_PEPPER, ARGON2_*; MIGRATE_LIMIT giới hạn cho lượt thử)
 */
import { createDb } from '../src/shared/db';
import { PasswordHasher } from '../src/sau/password-hasher';
import { hasherOptionsFromEnv } from '../src/sau/password-hasher.options';
import { wrapLegacyHashes } from '../src/sau/wrap-legacy-migration';

const CONCURRENCY = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
const LIMIT = process.env.MIGRATE_LIMIT ? Number(process.env.MIGRATE_LIMIT) : undefined;

const opts = hasherOptionsFromEnv();
const hasher = new PasswordHasher(opts);
const db = createDb({ max: 10 });

try {
  const pending = await db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).where('hash_version', '=', 0).executeTakeFirstOrThrow();
  console.log(`Cần bọc ${pending.n} hash MD5 (concurrency=${CONCURRENCY}, m=${opts.memoryCost}KiB t=${opts.timeCost} p=${opts.parallelism})...`);
  const t0 = Date.now();
  const n = await wrapLegacyHashes(db, hasher, { concurrency: CONCURRENCY, limit: LIMIT });
  const secs = (Date.now() - t0) / 1000;
  const leftMd5 = await db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).where('password_md5', 'is not', null).executeTakeFirstOrThrow();
  console.log(`Bọc xong ${n} hash trong ${secs.toFixed(1)} s (${(n / secs).toFixed(1)} hash/giây). Còn ${leftMd5.n} dòng giữ password_md5. Lộ DB giờ không còn là lộ mật khẩu rõ.`);
} finally {
  await db.destroy();
}
