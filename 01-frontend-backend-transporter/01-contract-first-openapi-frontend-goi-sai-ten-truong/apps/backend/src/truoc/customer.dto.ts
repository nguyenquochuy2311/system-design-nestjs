/**
 * Bản "trước" (code-first): DTO là nguồn sự thật, tài liệu (nếu có) sinh sau khi merge. Đổi tên trường ở đây
 * thì backend vẫn biên dịch, test của backend vẫn xanh, còn web không biết gì (README mục 1).
 */
import type { CustomerRecord, CustomerTierValue } from '../shared/customer-store.js';

export class CustomerDto {
  id!: string;
  name!: string;
  email!: string;
  phone!: string | null;
  tier!: CustomerTierValue;
  address!: { line1: string; city: string };
  tags!: string[];
  creditLimit!: number;
  createdAt!: string;
}

export class CreateCustomerDto {
  name!: string;
  email!: string;
  phone?: string | null;
  tier!: CustomerTierValue;
  address!: { line1: string; city: string };
  tags?: string[];
}

export class CustomerPresenter {
  toDto(r: CustomerRecord): CustomerDto {
    return {
      id: r.id,
      name: r.companyName,
      email: r.email,
      phone: r.phone,
      tier: r.tier,
      address: { line1: r.billingStreet, city: r.billingCity },
      tags: r.tags,
      creditLimit: r.creditLimitVnd,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
