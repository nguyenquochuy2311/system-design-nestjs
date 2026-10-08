/**
 * Dữ liệu khách hàng trong bộ nhớ, dùng chung cho hai bản backend. Pattern nằm ở hợp đồng giữa hai đội,
 * không ở tầng lưu trữ, nên lab không dựng PostgreSQL (README mục 4).
 * Tên cột "kiểu DB" (companyName, billingStreet...) cố ý khác tên trường của API: bản đồ giữa hai bên là chỗ
 * backend hay đổi tên trường nhất.
 */
export type CustomerTierValue = 'standard' | 'gold' | 'platinum';

export interface CustomerRecord {
  id: string;
  companyName: string;
  email: string;
  phone: string | null;
  tier: CustomerTierValue;
  billingStreet: string;
  billingCity: string;
  tags: string[];
  creditLimitVnd: number;
  taxCode: string | null;
  createdAt: Date;
}

export interface NewCustomerRecord {
  companyName: string;
  email: string;
  phone: string | null;
  tier: CustomerTierValue;
  billingStreet: string;
  billingCity: string;
  tags: string[];
  taxCode: string | null;
}

const SEED: CustomerRecord[] = [
  {
    id: 'cus_001', companyName: 'Công ty CP Minh Long', email: 'ketoan@minhlong.example', phone: '+84281234567',
    tier: 'gold', billingStreet: '45 Lê Lợi', billingCity: 'Hồ Chí Minh', tags: ['b2b', 'uu-tien'],
    creditLimitVnd: 500_000_000, taxCode: '0312345678', createdAt: new Date('2025-03-14T02:30:00Z'),
  },
  {
    id: 'cus_002', companyName: 'Cửa hàng Bình An', email: 'binhan@example.com', phone: null,
    tier: 'standard', billingStreet: '8 Trần Phú', billingCity: 'Đà Nẵng', tags: [],
    creditLimitVnd: 20_000_000, taxCode: null, createdAt: new Date('2025-11-02T09:15:00Z'),
  },
  {
    id: 'cus_003', companyName: 'Tập đoàn Sao Mai', email: 'mua-hang@saomai.example', phone: '+842439998888',
    tier: 'platinum', billingStreet: '1 Tràng Tiền', billingCity: 'Hà Nội', tags: ['b2b', 'hop-dong-nam'],
    creditLimitVnd: 2_000_000_000, taxCode: '0101234567', createdAt: new Date('2024-07-01T01:00:00Z'),
  },
];

export class CustomerStore {
  private readonly rows = new Map<string, CustomerRecord>(SEED.map((r) => [r.id, structuredClone(r)]));

  list(limit: number): CustomerRecord[] {
    return [...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
  }

  find(id: string): CustomerRecord | undefined {
    return this.rows.get(id);
  }

  create(input: NewCustomerRecord): CustomerRecord {
    const id = `cus_${String(this.rows.size + 1).padStart(3, '0')}`;
    const row: CustomerRecord = { ...input, id, creditLimitVnd: 0, createdAt: new Date() };
    this.rows.set(id, row);
    return row;
  }
}
