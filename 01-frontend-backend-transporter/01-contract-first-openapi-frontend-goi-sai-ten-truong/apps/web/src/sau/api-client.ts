/**
 * Bản "sau": client có kiểu sinh từ spec. Đường dẫn, tham số, body và kết quả đều kiểm bằng `tsc`;
 * không còn `as Customer` ở tầng gọi API.
 */
import createClient from 'openapi-fetch';
import type { components, paths } from '../../../../packages/api-contract/generated/schema.js';
import type { NewCustomerForm } from '../shared/new-customer-form.js';

// [PATTERN] Type lấy từ file sinh ra; sửa spec → sinh lại → chỗ dùng sai đỏ ngay lúc build.
export type Customer = components['schemas']['Customer'];
type CreateCustomerRequest = components['schemas']['CreateCustomerRequest'];
type ErrorResponse = components['schemas']['ErrorResponse'];

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ErrorResponse | undefined) {
    super(`API trả ${status}: ${body?.error.code ?? 'không rõ'}`);
  }
}

export function toCreateBody(form: NewCustomerForm): CreateCustomerRequest {
  return {
    name: form.companyName, email: form.email, phone: form.phone || null, tier: form.tier,
    address: { line1: form.street, city: form.city },
  };
}

export function createApi(baseUrl: string) {
  const client = createClient<paths>({ baseUrl });
  return {
    async getCustomer(customerId: string): Promise<Customer> {
      const { data, error, response } = await client.GET('/customers/{customerId}', { params: { path: { customerId } } });
      if (!data) throw new ApiError(response.status, error);
      return data;
    },
    async createCustomer(form: NewCustomerForm): Promise<Customer> {
      const { data, error, response } = await client.POST('/customers', { body: toCreateBody(form) });
      if (!data) throw new ApiError(response.status, error);
      return data;
    },
  };
}
