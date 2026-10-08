import { lazy, Suspense, type ComponentType } from 'react';
import { Link } from './link';
import { usePath } from './router';
import { ContactDetailScreen } from './screens/contact-detail';
import { ContactsScreen } from './screens/contacts';

/**
 * Màn tải lười. Khi bộ bắt lỗi tải chunk của bản sau gọi event.preventDefault() trên `vite:preloadError`, import()
 * của Vite trả về undefined thay vì ném lỗi; giữ promise treo để màn hình ở "Đang tải…" cho tới khi trang mới lên,
 * thay vì để React báo "lazy element type must resolve to a class or function".
 */
function lazyScreen(factory: () => Promise<{ default: ComponentType } | undefined>) {
  return lazy(() => factory().then((m) => m ?? new Promise<never>(() => {})));
}

const ReportsScreen = lazyScreen(() => import('./screens/reports'));

function Screen({ path }: { path: string }) {
  if (path === '/bao-cao') {
    return (
      <Suspense fallback={<p>Đang tải màn Báo cáo…</p>}>
        <ReportsScreen />
      </Suspense>
    );
  }
  const m = /^\/khach-hang\/(\d+)$/.exec(path);
  if (m) return <ContactDetailScreen key={m[1]} id={Number(m[1])} />;
  return <ContactsScreen />;
}

export function App() {
  const path = usePath();
  return (
    <>
      <header>
        <strong>CRM</strong>
        <Link to="/" data-nav="contacts" aria-current={path === '/' ? 'page' : undefined}>
          Danh bạ
        </Link>
        <Link to="/bao-cao" data-nav="reports" aria-current={path === '/bao-cao' ? 'page' : undefined}>
          Báo cáo
        </Link>
      </header>
      <main>
        <Screen path={path} />
      </main>
      <footer data-release={__RELEASE__}>Phiên bản {__RELEASE__}</footer>
    </>
  );
}
