'use client';
// Thành phần trình bày dùng chung cho hai bản (không gọi mạng, không giữ dữ liệu server): khác biệt giữa trước và
// sau chỉ nằm ở chỗ lấy dữ liệu.
import Link from 'next/link';
import { STATUS_LABEL, filtersLabel, isStatusFilter, type Order, type OrderFilters, type OrderListResponse, type StatusFilter, type Warehouse } from './contracts';

const time = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });

export function Spinner({ label = 'Đang tải danh sách…' }: { label?: string }) {
  return (
    <div className="spinner" role="status" data-testid="list-loading">
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" data-testid="list-error">
      Không tải được danh sách: {message}{' '}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

export function FilterBar({ filters, warehouses, onChange }: { filters: OrderFilters; warehouses: Warehouse[]; onChange: (patch: Partial<OrderFilters>) => void }) {
  return (
    <div className="bar">
      <label>
        Trạng thái{' '}
        <select
          data-testid="filter-status"
          value={filters.status}
          onChange={(e) => {
            const v = e.target.value;
            if (isStatusFilter(v)) onChange({ status: v });
          }}
        >
          {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kho{' '}
        <select data-testid="filter-warehouse" value={filters.warehouse} onChange={(e) => onChange({ warehouse: e.target.value })}>
          <option value="tat-ca">Tất cả kho</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
          {/* Kho trên URL nhưng danh mục kho chưa tải xong: vẫn giữ lựa chọn. */}
          {filters.warehouse !== 'tat-ca' && !warehouses.some((w) => w.id === filters.warehouse) && <option value={filters.warehouse}>{filters.warehouse}</option>}
        </select>
      </label>
    </div>
  );
}

export function Pager({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  return (
    <div className="bar">
      <button type="button" data-testid="page-prev" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Trang trước
      </button>
      <span data-testid="page-info">
        Trang {page}/{pageCount} · {total} đơn
      </span>
      <button type="button" data-testid="page-next" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        Trang sau →
      </button>
    </div>
  );
}

/** Chỉ báo độ mới: dữ liệu ảnh hưởng quyết định (đơn đã có người nhận) thì luôn cho người dùng biết đang xem bản lúc nào. */
export function Freshness({ generatedAt, fetching, error, onRetry }: { generatedAt: number; fetching: boolean; error: string | null; onRetry: () => void }) {
  // Đang tải lại (kể cả đang thử lại sau lỗi) thì báo "đang cập nhật"; lỗi chỉ hiện khi không còn request nào chạy.
  if (error && !fetching) {
    return (
      <span className="fresh error" data-testid="list-refresh-error">
        Không cập nhật được ({error}) · đang hiện dữ liệu lúc {time(generatedAt)}{' '}
        <button type="button" data-testid="list-retry" onClick={onRetry}>
          Thử lại
        </button>
      </span>
    );
  }
  return (
    <span className={fetching ? 'fresh refreshing' : 'fresh'} data-testid={fetching ? 'list-refreshing' : 'list-updated-at'}>
      {fetching ? `Đang cập nhật… (đang hiện dữ liệu lúc ${time(generatedAt)})` : `Cập nhật lúc ${time(generatedAt)}`}
    </span>
  );
}

export function OrderTable({ data, hrefBase, dim = false }: { data: OrderListResponse; hrefBase: string; dim?: boolean }) {
  return (
    <table className={dim ? 'orders dim' : 'orders'} data-testid="order-table" data-generated-at={data.generatedAt} data-seq={data.seq} data-filters={filtersLabel(data.filters)} data-placeholder={dim ? '1' : '0'}>
      <thead>
        <tr>
          <th>Mã đơn</th>
          <th>Khách hàng</th>
          <th>Địa chỉ</th>
          <th>Kho</th>
          <th>Trạng thái</th>
          <th>Shipper</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((o) => (
          <tr key={o.id} data-testid="order-row" data-id={o.id} data-status={o.status} data-warehouse={o.warehouse}>
            <td>
              {/* prefetch={false}: 50 liên kết trong màn hình sẽ tạo 50 request prefetch tới Next ở mỗi lần hiện danh sách. */}
              <Link href={`${hrefBase}/${o.id}`} prefetch={false} data-testid="order-link">
                {o.code}
              </Link>
            </td>
            <td>{o.customer}</td>
            <td>{o.address}</td>
            <td>{o.warehouse}</td>
            <td>
              <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </td>
            <td>{o.assignee ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OrderDetailView({
  order,
  onAssign,
  assigning,
  message,
  onBack,
}: {
  order: Order;
  onAssign?: (shipper: string) => void;
  assigning?: boolean;
  message?: string | null;
  onBack: () => void;
}) {
  return (
    <div className="detail" data-testid="order-detail" data-id={order.id} data-status={order.status}>
      <div className="bar">
        <button type="button" data-testid="detail-back" onClick={onBack}>
          ← Danh sách
        </button>
        <h2 style={{ margin: 0 }}>{order.code}</h2>
        <span className={`status ${order.status}`} data-testid="detail-status">
          {STATUS_LABEL[order.status]}
        </span>
      </div>
      <dl>
        <dt>Khách hàng</dt>
        <dd>{order.customer}</dd>
        <dt>Điện thoại</dt>
        <dd>{order.phone}</dd>
        <dt>Địa chỉ</dt>
        <dd>{order.address}</dd>
        <dt>Kho</dt>
        <dd>{order.warehouse}</dd>
        <dt>Thu hộ</dt>
        <dd>{order.codAmount.toLocaleString('vi-VN')} đ</dd>
        <dt>Shipper</dt>
        <dd data-testid="detail-assignee">{order.assignee ?? '—'}</dd>
      </dl>
      {onAssign && order.status === 'moi' && (
        <button type="button" data-testid="assign" disabled={assigning} onClick={() => onAssign('Shipper 07')}>
          {assigning ? 'Đang phân đơn…' : 'Phân cho Shipper 07'}
        </button>
      )}
      {message && <p data-testid="detail-message">{message}</p>}
    </div>
  );
}
