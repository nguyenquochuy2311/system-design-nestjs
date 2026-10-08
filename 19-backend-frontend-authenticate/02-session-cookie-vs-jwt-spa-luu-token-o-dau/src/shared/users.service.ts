import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB } from './db';
import { verifyPassword } from './password';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  locked: boolean;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Pool) {}

  async verifyCredentials(email: string, password: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow & { password_hash: string }>(
      'SELECT id, email, display_name, locked, password_hash FROM users WHERE email = $1',
      [email],
    );
    const row = res.rows[0];
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    const { password_hash: _ph, ...user } = row;
    return user;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>('SELECT id, email, display_name, locked FROM users WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>('SELECT id, email, display_name, locked FROM users WHERE email = $1', [email]);
    return res.rows[0] ?? null;
  }

  /** Khóa tài khoản. Việc xóa phiên do SessionRevoker đảm nhiệm (bản `sau`). */
  async lock(id: string): Promise<void> {
    await this.db.query('UPDATE users SET locked = TRUE WHERE id = $1', [id]);
  }

  async unlock(id: string): Promise<void> {
    await this.db.query('UPDATE users SET locked = FALSE WHERE id = $1', [id]);
  }
}
