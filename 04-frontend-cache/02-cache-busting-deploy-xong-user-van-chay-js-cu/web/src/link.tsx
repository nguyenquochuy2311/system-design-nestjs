import type { AnchorHTMLAttributes } from 'react';
import { navigate } from './router';

/** Link điều hướng trong SPA: không tải lại trang, trừ khi móc beforeNavigate quyết định khác (bản sau). */
export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
