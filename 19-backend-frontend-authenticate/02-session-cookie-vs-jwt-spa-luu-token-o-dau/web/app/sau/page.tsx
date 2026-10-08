'use client';
import { type FormEvent, useEffect, useState } from 'react';

interface Note {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}

function readCookie(name: string): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : '';
}

// Bản SAU: không có token trong JS. Cookie __Host-sid là HttpOnly (JS không đọc được). Request đổi dữ liệu gắn
// token CSRF đọc từ cookie `csrf` (double-submit). Trình duyệt tự gửi cookie phiên cùng origin.
export default function SauPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [email, setEmail] = useState('alice@crm.local');
  const [password, setPassword] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/sau/me', { credentials: 'include' });
      if (r.ok) {
        setAuthed(true);
        await fetch('/api/sau/csrf', { credentials: 'include' }); // đảm bảo có cookie csrf
        void loadNotes();
      } else setAuthed(false);
    })();
  }, []);

  async function loadNotes() {
    const r = await fetch('/api/sau/notes', { credentials: 'include' });
    if (r.ok) setNotes((await r.json()) as Note[]);
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/sau/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      setAuthed(true);
      setMsg('');
      void loadNotes();
    } else setMsg('đăng nhập thất bại');
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    await fetch('/api/sau/notes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'X-CSRF-Token': readCookie('csrf') },
      body: JSON.stringify({ body }),
    });
    setBody('');
    void loadNotes();
  }

  async function logout() {
    await fetch('/api/sau/logout', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': readCookie('csrf') } });
    setAuthed(false);
    setNotes([]);
  }

  if (authed === null) return <main>Đang tải…</main>;

  if (!authed) {
    return (
      <main>
        <h1>/sau — Session cookie __Host-sid</h1>
        <form onSubmit={login}>
          <input data-testid="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <br />
          <input data-testid="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mật khẩu" />
          <br />
          <button type="submit">Đăng nhập</button>
        </form>
        <p data-testid="msg">{msg}</p>
      </main>
    );
  }

  return (
    <main data-testid="app" data-auth="in">
      <h1>/sau — Ghi chú khách hàng</h1>
      <button onClick={logout}>Đăng xuất</button>
      <form onSubmit={addNote}>
        <textarea data-testid="note-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="ghi chú (lưu nguyên HTML)" />
        <br />
        <button type="submit">Thêm ghi chú</button>
      </form>
      <div data-testid="notes">
        {/* CỐ Ý không sanitize: tái hiện stored XSS */}
        {notes.map((n) => (
          <div key={n.id} className="note" data-testid="note">
            <strong>{n.author_name}</strong>
            <div dangerouslySetInnerHTML={{ __html: n.body }} />
          </div>
        ))}
      </div>
    </main>
  );
}
