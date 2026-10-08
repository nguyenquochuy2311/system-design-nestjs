import type { NewCustomerForm } from '../shared/new-customer-form.js';
import type { CreateCustomerBody, Customer } from './customer.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API trả ${status}`);
  }
}

export function toCreateBody(form: NewCustomerForm): CreateCustomerBody {
  return {
    name: form.companyName, email: form.email, phone: form.phone || null, tier: form.tier,
    address: { line1: form.street, city: form.city },
  };
}

export function createApi(baseUrl: string) {
  return {
    async getCustomer(customerId: string): Promise<Customer> {
      const res = await fetch(`${baseUrl}/customers/${encodeURIComponent(customerId)}`);
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return (await res.json()) as Customer; // ép kiểu: không ai kiểm JSON thật có đúng hình dạng này không
    },
    async createCustomer(form: NewCustomerForm): Promise<Customer> {
      const res = await fetch(`${baseUrl}/customers`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toCreateBody(form)),
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return (await res.json()) as Customer;
    },
  };
}
