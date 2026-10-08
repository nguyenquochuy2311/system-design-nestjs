import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import type { PasswordHasher } from './password-hasher';

/** Chạy `fn` trên từng phần tử với tối đa `concurrency` việc song song. */
async function mapLimit<T, R>(items: T[], concurrency: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/**
 * [PATTERN] Migration một lần: BỌC hash MD5 hiện có thành argon2id(md5) và XÓA cột MD5 trong CÙNG một câu
 * UPDATE (hash_version 0 → 1, password_md5 → NULL). Phải xóa MD5 cùng lúc: nếu chỉ thêm password_hash mà
 * giữ password_md5, một bản dump sau migration VẪN lộ mật khẩu rõ qua cột MD5 không salt (lỗi gặp thật, lọt
 * qua test tới khi kiểm đầu cuối — xem nhật ký 19/01). Chạy theo lô, tiếp tục được khi gián đoạn (chỉ lấy
 * các dòng còn hash_version = 0).
 */
export async function wrapLegacyHashes(
  db: Kysely<Database>,
  hasher: PasswordHasher,
  opts: { concurrency?: number; limit?: number } = {},
): Promise<number> {
  const concurrency = opts.concurrency ?? 4;
  let q = db.selectFrom('users').select(['id', 'password_md5']).where('hash_version', '=', 0).orderBy('id');
  if (opts.limit) q = q.limit(opts.limit);
  const rows = (await q.execute()).filter((r): r is { id: string; password_md5: string } => r.password_md5 !== null);
  if (rows.length === 0) return 0;

  const wrapped = await mapLimit(rows, concurrency, async (r) => ({ id: r.id, hash: await hasher.hash(r.password_md5) }));

  const batch = 500;
  for (let i = 0; i < wrapped.length; i += batch) {
    const slice = wrapped.slice(i, i + batch);
    const values = sql.join(slice.map((w) => sql`(${Number(w.id)}::bigint, ${w.hash}::text)`));
    // XÓA MD5 (password_md5 = NULL) ngay trong câu bọc — không để dump còn cột MD5 không salt.
    await sql`
      UPDATE users SET password_hash = v.hash, hash_version = 1, password_md5 = NULL
      FROM (VALUES ${values}) AS v(id, hash)
      WHERE users.id = v.id
    `.execute(db);
  }
  return wrapped.length;
}
