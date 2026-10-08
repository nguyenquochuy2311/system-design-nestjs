// User mẫu của lab (dữ liệu TỔNG HỢP, chỉ dùng trên localhost của lab). Mật khẩu ở đây là giá trị fixture để
// bench/test đăng nhập được — KHÔNG phải secret thật, không tái sử dụng ở đâu khác.
export interface SeedUser {
  email: string;
  displayName: string;
  password: string;
}

export const SEED_USERS: SeedUser[] = [
  { email: 'alice@crm.local', displayName: 'Alice (sales)', password: 'alice-lab-pw-2026' },
  { email: 'bob@crm.local', displayName: 'Bob (sales)', password: 'bob-lab-pw-2026' },
];
