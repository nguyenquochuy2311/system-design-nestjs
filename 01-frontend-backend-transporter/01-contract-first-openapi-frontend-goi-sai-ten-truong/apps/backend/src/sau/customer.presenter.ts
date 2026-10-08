/**
 * Bản "sau": backend cài đặt theo `openapi.yaml`, không tự định nghĩa hình dạng API. Presenter vẫn là code viết tay
 * (bản đồ từ bản ghi sang JSON), nên có thể trôi khỏi spec; test hợp đồng là lớp bắt chỗ trôi đó (README mục 3.4).
 */
import type { CustomerRecord, CustomerTierValue } from '../shared/customer-store.js';

export interface CustomerBody {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tier: CustomerTierValue;
  address: { line1: string; city: string };
  tags: string[];
  creditLimit: number;
  createdAt: string;
}

export class CustomerPresenter {
  toBody(r: CustomerRecord): CustomerBody {
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
