'use client';
// Đăng nhập giả lập (chọn điều phối viên, không mật khẩu): đủ để có cookie uid cho API và để thử đăng xuất trên máy dùng chung.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage, login } from './api';

const DISPATCHERS = ['d01', 'd02', 'd03', 'd04', 'd05', 'd06'];

export function LoginForm({ base }: { base: 'truoc' | 'sau' }) {
  const router = useRouter();
  const [uid, setUid] = useState('d01');
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="page">
      <h1>Đăng nhập điều phối ({base === 'sau' ? 'bản sau' : 'bản trước'})</h1>
      <form
        className="bar"
        data-testid="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          login(uid).then(
            () => router.push(`/${base}/orders?status=moi&warehouse=tat-ca&page=1`),
            (err) => setError(errorMessage(err)),
          );
        }}
      >
        <select data-testid="login-uid" value={uid} onChange={(e) => setUid(e.target.value)}>
          {DISPATCHERS.map((d) => (
            <option key={d} value={d}>
              Điều phối viên {d.slice(1)} (khu vực {['Quận 1', 'Quận 7', 'Thủ Đức'][(Number(d.slice(1)) - 1) % 3]})
            </option>
          ))}
        </select>
        <button type="submit" data-testid="login-submit">
          Đăng nhập
        </button>
      </form>
      {error && <p className="error-box">{error}</p>}
    </main>
  );
}
