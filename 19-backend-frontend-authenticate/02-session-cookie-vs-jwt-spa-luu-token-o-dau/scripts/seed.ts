// Seed DB chính (public) với user mẫu cho bench trình duyệt. Idempotent: xóa rồi chèn lại.
import { Pool } from 'pg';
import { hashPassword } from '../src/shared/password';
import { SEED_USERS } from '../src/shared/seed-users';

const url = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm';
const pool = new Pool({ connectionString: url });

await pool.query('DELETE FROM notes');
await pool.query('DELETE FROM users');
for (const u of SEED_USERS) {
  await pool.query('INSERT INTO users (email, display_name, password_hash, locked) VALUES ($1, $2, $3, false)', [
    u.email,
    u.displayName,
    hashPassword(u.password),
  ]);
}
console.log(`Đã seed ${SEED_USERS.length} user: ${SEED_USERS.map((u) => u.email).join(', ')}`);
await pool.end();
