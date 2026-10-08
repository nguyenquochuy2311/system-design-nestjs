/// <reference types="vite/client" />

// Hằng số thay lúc build (web/vite.config.ts, define).
declare const __SITE__: 'truoc' | 'sau';
declare const __RELEASE__: string;
declare const __CONTRACT__: 1 | 2;
declare const __REPORTS_LAYOUT__: 'a' | 'b' | 'c';
declare const __VERSION_POLL_MS__: number;

interface Window {
  /** Bản đang chạy trong tab này (script đo đọc). */
  __APP__?: { version: string; site: string };
  /** Bộ đo lỗi của lab, nạp inline trong index.html trước mọi module. */
  __LAB__?: { tab: string; errors: { kind: string; message: string }[]; report: (kind: string, message: string) => void };
}
