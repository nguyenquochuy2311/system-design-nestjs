import { useEffect, useState } from 'react';
import { getContacts, type Contact } from '../api';
import { initials } from '../format';
import { Link } from '../link';

export function ContactsScreen() {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getContacts().then(setRows, (e: unknown) => setError(String(e)));
  }, []);
  if (error) return <p role="alert">Không tải được danh bạ: {error}</p>;
  if (!rows) return <p>Đang tải danh bạ…</p>;
  return (
    <section data-screen="contacts">
      <h1>Danh bạ khách hàng</h1>
      <table>
        <thead>
          <tr>
            <th />
            <th>Khách hàng</th>
            <th>Công ty</th>
            <th>Điện thoại</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="avatar">{initials(c.label)}</span>
              </td>
              <td>
                <Link to={`/khach-hang/${c.id}`} data-contact={c.id}>
                  {c.label}
                </Link>
              </td>
              <td>{c.company}</td>
              <td>{c.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
