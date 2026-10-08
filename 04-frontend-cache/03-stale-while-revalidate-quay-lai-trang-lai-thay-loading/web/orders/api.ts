// Gọi API từ trình duyệt (cùng origin, Next.js chuyển tiếp /api/* tới NestJS). Dùng chung cho hai bản.
import { filtersToQuery, type AssignResult, type Me, type Order, type OrderFilters, type OrderListResponse, type Warehouse } from './contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // cache: 'no-store' để HTTP cache của trình duyệt không chen vào; cache của bài là cache dữ liệu trong ứng dụng.
  const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchOrders = (f: OrderFilters, signal?: AbortSignal) => request<OrderListResponse>(`/api/orders?${filtersToQuery(f)}`, { signal });
export const fetchOrder = (id: string, signal?: AbortSignal) => request<Order>(`/api/orders/${encodeURIComponent(id)}`, { signal });
export const fetchWarehouses = (signal?: AbortSignal) => request<Warehouse[]>('/api/warehouses', { signal });
export const fetchMe = (signal?: AbortSignal) => request<Me>('/api/me', { signal });

export const assignOrder = (id: string, shipper: string) =>
  request<AssignResult>(`/api/orders/${encodeURIComponent(id)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipper }),
  });

export const login = (uid: string) =>
  request<void>('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid }) });
export const logout = () => request<void>('/api/session/logout', { method: 'POST' });

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
