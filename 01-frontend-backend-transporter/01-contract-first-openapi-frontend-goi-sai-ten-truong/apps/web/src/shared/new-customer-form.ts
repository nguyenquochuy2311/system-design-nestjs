/** Giá trị của form "Thêm khách hàng" trên web (trạng thái giao diện, không phải hợp đồng API). */
export interface NewCustomerForm {
  companyName: string;
  email: string;
  phone: string;
  tier: 'standard' | 'gold' | 'platinum';
  street: string;
  city: string;
}

export const SAMPLE_FORM: NewCustomerForm = {
  companyName: 'Công ty TNHH Hoa Sen', email: 'lienhe@hoasen.example', phone: '+84901234567',
  tier: 'standard', street: '12 Nguyễn Huệ', city: 'Hồ Chí Minh',
};

/** Avatar chữ cái đầu: "Công ty CP Minh Long" → "CM". */
export function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export const formatVnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
