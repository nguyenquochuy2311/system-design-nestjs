// Quy ước truy vấn của bản sau: khóa, độ mới theo loại dữ liệu, làm mới định kỳ. Mọi màn hình lấy dữ liệu đơn qua đây.
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { fetchMe, fetchOrder, fetchOrders, fetchWarehouses } from '../api';
import type { OrderFilters, OrderListResponse } from '../contracts';

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  // [PATTERN] khóa chứa MỌI tham số làm đổi kết quả (trạng thái, kho, trang). Thiếu một tham số là hiện kết quả
  // của bộ lọc khác dưới cùng một khóa.
  list: (f: OrderFilters) => [...orderKeys.lists(), { status: f.status, warehouse: f.warehouse, page: f.page }] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

// [PATTERN] staleTime theo loại dữ liệu: quá thời gian này thì dữ liệu "cũ" — vẫn hiện ngay, đồng thời làm mới ở nền.
export const STALE_TIME = {
  orderList: 15_000,
  orderDetail: 15_000,
  warehouses: 10 * 60_000,
  me: Number.POSITIVE_INFINITY,
};
// [PATTERN] truy vấn không còn màn hình nào dùng được giữ thêm gcTime rồi mới bị dọn: quay lại trong 10 phút là có ngay.
export const GC_TIME = 10 * 60_000;
// [PATTERN] ràng buộc nghiệp vụ "trạng thái đơn không cũ quá 30 giây khi đang nhìn": làm mới định kỳ trong lúc
// danh sách đang hiện (tab ẩn thì TanStack Query tự dừng, refetchIntervalInBackground mặc định false), và hẹn lần làm
// mới kế tiếp theo TUỔI của dữ liệu đang có chứ không theo một số cố định. TanStack Query 5.104 đặt lại bộ hẹn giờ lúc
// mount và mỗi lần truy vấn đổi trạng thái (tải xong), nên với số cố định N:
//  - hai bản chụp cách nhau N + thời gian một lần tải (lab: 30 s + 1,2 s = 31,2 s, vượt ràng buộc);
//  - quay lại trong staleTime (không tải lại) rồi ở lại danh sách thì bản chụp kế tiếp tới N sau lúc quay lại, cộng
//    thêm tuổi sẵn có của dữ liệu (tới 15 s + 28 s).
// 28 s = 30 s − độ trễ API (1,2 s) − lề.
export const ORDER_LIST_MAX_AGE_MS = 28_000;
export const refetchByAge = (query: { state: { dataUpdatedAt: number; errorUpdatedAt: number } }): number => {
  // Lỗi cũng tính là một lần thử: mạng hỏng thì thử lại sau 28 s, không dồn dập mỗi giây.
  const last = Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt);
  return Math.max(1_000, ORDER_LIST_MAX_AGE_MS - (Date.now() - last));
};

export function makeQueryClient(): QueryClient {
  // retry 1 (mặc định 3, lùi 1 + 2 + 4 giây): mạng lỗi thì báo "không cập nhật được" sau khoảng 1 giây cộng độ trễ.
  return new QueryClient({ defaultOptions: { queries: { gcTime: GC_TIME, retry: 1 } } });
}

/** Chỉ cho script đo (biến thể "sau-khong-poll"): cookie lab_poll=off tắt làm mới định kỳ. Không có cookie = cấu hình của bài. */
const pollOverride = (): false | undefined => (typeof document !== 'undefined' && /(?:^|;\s*)lab_poll=off/.test(document.cookie) ? false : undefined);

/**
 * [PATTERN] Giữ dữ liệu cũ làm chỗ giữ chỉ khi đổi TRANG trong cùng bộ lọc (bảng mờ + "Đang cập nhật"), để không nhấp
 * nháy. Đổi trạng thái hay kho thì không giữ: ràng buộc "không hiện kết quả của bộ lọc khác".
 */
export const keepPreviousPageOf = (f: OrderFilters) => (previous: OrderListResponse | undefined) =>
  previous && previous.filters.status === f.status && previous.filters.warehouse === f.warehouse ? previous : undefined;

export const orderListQuery = (f: OrderFilters) =>
  queryOptions({
    queryKey: orderKeys.list(f),
    // Không truyền signal: rời màn hình lúc request nền đang chạy thì kết quả vẫn vào cache cho lần quay lại
    // (truyền signal thì TanStack Query hủy request khi truy vấn không còn ai dùng).
    queryFn: () => fetchOrders(f),
    staleTime: STALE_TIME.orderList,
    refetchInterval: pollOverride() ?? refetchByAge,
    placeholderData: keepPreviousPageOf(f),
  });

export const orderDetailQuery = (id: string) =>
  queryOptions({ queryKey: orderKeys.detail(id), queryFn: () => fetchOrder(id), staleTime: STALE_TIME.orderDetail });

export const warehousesQuery = () => queryOptions({ queryKey: ['warehouses'], queryFn: () => fetchWarehouses(), staleTime: STALE_TIME.warehouses });

export const meQuery = () => queryOptions({ queryKey: ['me'], queryFn: () => fetchMe(), staleTime: STALE_TIME.me });
