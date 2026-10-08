// Hợp đồng dữ liệu giữa API (src/) và web (web/). Chỉ có kiểu và hằng số, không có logic gọi mạng.

export const ORDER_STATUSES = ['moi', 'da-nhan', 'dang-giao', 'da-giao'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type StatusFilter = OrderStatus | 'tat-ca';

export const STATUS_LABEL: Record<StatusFilter, string> = {
  'tat-ca': 'Tất cả',
  moi: 'Mới',
  'da-nhan': 'Đã nhận',
  'dang-giao': 'Đang giao',
  'da-giao': 'Đã giao',
};

export const PAGE_SIZE = 50;

/** Mọi tham số làm đổi kết quả của danh sách. Bản sau đặt nguyên object này vào khóa truy vấn. */
export interface OrderFilters {
  status: StatusFilter;
  /** 'tat-ca' hoặc mã kho */
  warehouse: string;
  page: number;
}

export interface OrderRow {
  id: string;
  code: string;
  warehouse: string;
  customer: string;
  address: string;
  status: OrderStatus;
  assignee: string | null;
  updatedAt: number;
}

export interface Order extends OrderRow {
  region: string;
  phone: string;
  codAmount: number;
  createdAt: number;
}

export interface OrderListResponse {
  items: OrderRow[];
  /** Bộ lọc của chính dữ liệu này (để biết đang hiện dữ liệu của bộ lọc nào). */
  filters: OrderFilters;
  total: number;
  pageCount: number;
  /** Thời điểm API chụp dữ liệu (ms, đồng hồ của API) và số thứ tự thay đổi mới nhất đã có trong bản chụp. */
  generatedAt: number;
  seq: number;
}

export interface Warehouse {
  id: string;
  name: string;
}

export interface Me {
  uid: string;
  name: string;
  region: string;
  regionName: string;
}

export interface AssignResult {
  order: Order;
  seq: number;
}

export const DEFAULT_FILTERS: OrderFilters = { status: 'moi', warehouse: 'tat-ca', page: 1 };

export function isStatusFilter(v: unknown): v is StatusFilter {
  return v === 'tat-ca' || (ORDER_STATUSES as readonly unknown[]).includes(v);
}

/** Đọc bộ lọc từ query string; giá trị lạ về mặc định. */
export function parseFilters(get: (name: string) => string | null): OrderFilters {
  const status = get('status');
  const page = Number(get('page') ?? '1');
  return {
    status: isStatusFilter(status) ? status : DEFAULT_FILTERS.status,
    warehouse: get('warehouse') || DEFAULT_FILTERS.warehouse,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export const filtersToQuery = (f: OrderFilters): string => new URLSearchParams({ status: f.status, warehouse: f.warehouse, page: String(f.page) }).toString();

/** Chuỗi ổn định của bộ lọc, dùng làm nhãn trong log đo. */
export const filtersLabel = (f: OrderFilters): string => `${f.status}|${f.warehouse}|${f.page}`;
