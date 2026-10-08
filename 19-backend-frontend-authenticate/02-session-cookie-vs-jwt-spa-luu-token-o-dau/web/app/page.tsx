import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>Lab 19/02 — Session Cookie vs JWT</h1>
      <p>SPA + API cùng origin. Trang ghi chú CỐ Ý không sanitize để giả lập stored XSS (chỉ chạy trên localhost của lab).</p>
      <ul>
        <li>
          <Link href="/truoc">/truoc</Link> — JWT trong localStorage (bản trước)
        </li>
        <li>
          <Link href="/sau">/sau</Link> — session cookie __Host-sid + Redis + CSRF (bản sau)
        </li>
      </ul>
    </main>
  );
}
