import Link from 'next/link';

export default function Home() {
  return (
    <main className="page">
      <h1>Lab 04/03 — Stale-While-Revalidate phía client</h1>
      <ul>
        <li>
          <Link href="/truoc/login">Bản trước</Link>: <code>useEffect</code> + <code>useState</code>, mỗi lần quay lại danh sách là tải lại từ đầu.
        </li>
        <li>
          <Link href="/sau/login">Bản sau</Link>: TanStack Query, hiện ngay bản đang có rồi làm mới ở nền.
        </li>
        <li>
          <Link href="/rsc/orders?status=moi">Server Component</Link>: danh sách dựng ở server, chỉ để kiểm cache router của Next.js.
        </li>
      </ul>
    </main>
  );
}
