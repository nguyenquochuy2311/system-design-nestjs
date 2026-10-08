/**
 * Bản "trước": type viết tay theo trang wiki và tin nhắn chat. TypeScript tin type này tuyệt đối,
 * nên backend đổi gì thì `tsc` vẫn xanh (README mục 1, "Nguyên nhân kỹ thuật").
 */
export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tier: 'standard' | 'gold' | 'platinum';
  address: { line1: string; city: string };
  tags: string[];
  creditLimit: number;
  createdAt: string;
}

export interface CreateCustomerBody {
  name: string;
  email: string;
  phone?: string | null;
  tier: Customer['tier'];
  address: { line1: string; city: string };
  tags?: string[];
}
