const KEY = 'lab:chunk-reload-at';
const LOOP_GUARD_MS = 10_000;

/**
 * [PATTERN] Lưới an toàn cuối: chunk tải lười không tải được (đã bị xóa, mạng lỗi) thì tải lại trang một lần ở đúng
 * đích. Vite 8.3.3 phát sự kiện `vite:preloadError` trên window khi import() động hoặc file preload của nó lỗi
 * (đã kiểm bằng test/chunk-error-reloads-once.test.ts); event.preventDefault() thì Vite không ném lỗi nữa.
 */
export function installChunkErrorHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const message = event.payload instanceof Error ? event.payload.message : String(event.payload);
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? '0');
    } catch {
      // sessionStorage bị chặn: coi như chưa tải lại lần nào
    }
    // Vừa tải lại vì lỗi này mà vẫn lỗi: để lỗi hiện ra thay vì tải lại mãi.
    if (Date.now() - last < LOOP_GUARD_MS) return;
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return; // không ghi được dấu chống lặp thì không tải lại
    }
    event.preventDefault();
    window.__LAB__?.report('chunk-reload', message);
    // URL hiện tại đã là đích: router pushState trước khi render màn tải lười.
    location.assign(location.href);
  });
}
