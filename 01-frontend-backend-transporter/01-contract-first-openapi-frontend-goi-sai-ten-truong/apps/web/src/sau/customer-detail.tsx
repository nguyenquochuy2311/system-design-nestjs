import { formatVnd, initials } from '../shared/new-customer-form.js';
import type { Customer } from './api-client.js';

const TIER_LABEL: Record<Customer['tier'], string> = { standard: 'Thường', gold: 'Vàng', platinum: 'Bạch kim' };

/** Màn hình "Chi tiết khách hàng" (bản sau, type sinh từ spec). */
export function CustomerDetail({ customer }: { customer: Customer }) {
  return (
    <section>
      <span data-field="avatar">{initials(customer.name)}</span>
      <h1 data-field="name">{customer.name}</h1>
      <a data-field="email" href={`mailto:${customer.email}`}>{customer.email}</a>
      <p data-field="phone">{customer.phone ?? 'Chưa có số điện thoại'}</p>
      <p data-field="tier">Hạng {TIER_LABEL[customer.tier]}</p>
      <p data-field="city">{customer.address.line1}, {customer.address.city}</p>
      <ul data-field="tags">{customer.tags.map((t) => <li key={t}>{t}</li>)}</ul>
      <p data-field="credit">Hạn mức {formatVnd(customer.creditLimit)}</p>
      <p data-field="created">Khách từ {new Date(customer.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
    </section>
  );
}
