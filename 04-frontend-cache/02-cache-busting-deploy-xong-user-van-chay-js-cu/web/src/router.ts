import { useSyncExternalStore } from 'react';

// Router tối giản dùng History API: đủ cho 3 màn hình, không cần thư viện.
const listeners = new Set<() => void>();
const navigatedListeners = new Set<(to: string) => void>();
let beforeNavigate: ((to: string) => boolean) | null = null;

/** Móc trước mỗi lần điều hướng trong app; trả true nghĩa là móc đã tự xử lý (ví dụ tải trang đầy đủ). */
export function setBeforeNavigate(fn: (to: string) => boolean): void {
  beforeNavigate = fn;
}

export function onNavigated(fn: (to: string) => void): void {
  navigatedListeners.add(fn);
}

export function navigate(to: string): void {
  if (beforeNavigate?.(to)) return;
  history.pushState(null, '', to);
  for (const l of listeners) l();
  for (const l of navigatedListeners) l(to);
}

window.addEventListener('popstate', () => {
  for (const l of listeners) l();
});

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}
