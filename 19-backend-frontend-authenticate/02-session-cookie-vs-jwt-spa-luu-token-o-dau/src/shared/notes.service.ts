import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB } from './db';

export interface NoteRow {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

@Injectable()
export class NotesService {
  constructor(@Inject(DB) private readonly db: Pool) {}

  // CỐ Ý KHÔNG sanitize `body`: ô ghi chú lưu nguyên HTML để tái hiện stored XSS (chỉ chạy trên localhost của lab).
  async create(authorId: string, body: string): Promise<NoteRow> {
    const res = await this.db.query<NoteRow>(
      `INSERT INTO notes (author_id, body) VALUES ($1, $2)
       RETURNING id, author_id, body, created_at,
         (SELECT display_name FROM users WHERE users.id = $1) AS author_name`,
      [authorId, body],
    );
    return res.rows[0]!;
  }

  async list(): Promise<NoteRow[]> {
    const res = await this.db.query<NoteRow>(
      `SELECT n.id, n.author_id, n.body, n.created_at, u.display_name AS author_name
       FROM notes n JOIN users u ON u.id = n.author_id
       ORDER BY n.created_at ASC`,
    );
    return res.rows;
  }

  async clear(): Promise<void> {
    await this.db.query('DELETE FROM notes');
  }
}
