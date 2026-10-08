import { onNavigated, setBeforeNavigate } from '../router';

let newer: string | null = null;

/**
 * [PATTERN] Báo có bản mới mà không ép tải lại.
 * - Hỏi /version.json (no-cache) sau mỗi lần đổi màn hình, mỗi __VERSION_POLL_MS__ và khi tab hiện lại.
 * - Thấy bản khác bản đang chạy: hiện banner "Tải lại"; KHÔNG tự tải lại vì người dùng có thể đang gõ dở.
 * - Lần điều hướng kế tiếp sau khi đã biết có bản mới: tải trang đầy đủ ở đích thay vì điều hướng trong SPA.
 *   Người dùng đang rời màn hình hiện tại, nên không mất gì đang gõ, và trang đích chạy bản mới.
 */
export function startVersionCheck(): void {
  setBeforeNavigate((to) => {
    if (!newer) return false;
    location.assign(to);
    return true;
  });
  onNavigated(() => void check());
  window.setInterval(() => void check(), __VERSION_POLL_MS__);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}

async function check(): Promise<void> {
  let version: string;
  try {
    // cache: 'no-cache' = luôn hỏi lại máy gốc, kể cả khi một tầng nào đó lỡ gắn max-age cho version.json.
    const res = await fetch('/version.json', { cache: 'no-cache' });
    if (!res.ok) return;
    version = ((await res.json()) as { version: string }).version;
  } catch {
    return; // mất mạng hay đang deploy: lần điều hướng sau hỏi lại
  }
  if (version === __RELEASE__ || version === newer) return;
  newer = version;
  showBanner(version);
}

function showBanner(version: string): void {
  let el = document.getElementById('update-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'update-banner';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.dataset.version = version;
  el.textContent = `Đã có phiên bản mới (${version}). `;
  const button = document.createElement('button');
  button.textContent = 'Tải lại';
  button.addEventListener('click', () => location.reload());
  el.append(button);
}
