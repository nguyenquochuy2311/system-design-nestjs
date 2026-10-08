// Kiểu của bộ đo gắn trên window (chỉ phục vụ test và script đo, không thuộc pattern). Dùng chung cho web, test, bench.

export interface LabEvent {
  /** Date.now() của trình duyệt (cùng đồng hồ máy với API vì chạy cùng máy). */
  t: number;
  type: string;
  [k: string]: unknown;
}

export interface ListEvent extends LabEvent {
  type: 'list';
  variant: string;
  /** Bộ lọc đang chọn trên URL. */
  key: string;
  /** Bộ lọc của dữ liệu đang hiện (khác key khi đang hiện dữ liệu giữ chỗ của trang trước). */
  dataKey: string | null;
  generatedAt: number | null;
  seq: number | null;
  spinner: boolean;
  fetching: boolean;
  placeholder: boolean;
  error: boolean;
  rows: number;
}

export interface LabWindow {
  events: LabEvent[];
  /** Bản sau: số truy vấn đang có trong cache của QueryClient. */
  queryCount?: () => number;
  queryKeys?: () => unknown[];
}

declare global {
  interface Window {
    __LAB__?: LabWindow;
  }
}
