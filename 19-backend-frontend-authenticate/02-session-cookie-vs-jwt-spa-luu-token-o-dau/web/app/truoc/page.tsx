'use client';
import { type FormEvent, useEffect, useState } from 'react';

interface Note {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}

// Bản TRƯỚC: token JWT nằm trong localStorage, gắn thủ công vào header Authorization. Mọi JavaScript trên trang
// (kể cả script chèn qua XSS) đọc được localStorage → lấy được token.
export default function TruocPage() {
  const [token, setToken] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [email, setEmail] = useState('alice@crm.local');
  const [password, setPassword] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const t = localStorage.getItem('jwt');
    if (t) {
      setToken(t);
      void loadNotes(t);
    }
  }, []);

  async function loadNotes(t: string) {
    const r = await fetch('/api/truoc/notes', { headers: { Authorization: `Bearer ${t}` } });
    if (r.ok) setNotes((await r.json()) as Note[]);
    else if (r.status === 401) setMsg('token không hợp lệ');
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/truoc/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      const d = (await r.json()) as { token: string };
      localStorage.setItem('jwt', d.token); // [TRƯỚC] lưu token nơi JS đọc được
      setToken(d.token);
      setMsg('');
      void loadNotes(d.token);
    } else setMsg('đăng nhập thất bại');
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    await fetch('/api/truoc/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body }),
    });
    setBody('');
    void loadNotes(token);
  }

  function logout() {
    localStorage.removeItem('jwt');
    setToken(null);
    setNotes([]);
  }

  if (!token) {
    return (
      <main>
        <h1>/truoc — JWT trong localStorage</h1>
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
      <h1>/truoc — Ghi chú khách hàng</h1>
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
