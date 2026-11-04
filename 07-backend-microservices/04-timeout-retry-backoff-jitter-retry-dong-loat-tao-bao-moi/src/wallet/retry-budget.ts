/**
 * [PATTERN] Ngân sách retry kiểu token bucket: mỗi lệnh mới nạp thêm một phần token, mỗi lần retry tiêu một token.
 * Tỷ lệ 0,1 nghĩa là về lâu dài retry không vượt 10 % lưu lượng; hết token thì fail-fast thay vì đổ thêm tải vào đối tác.
 */
export class RetryBudget {
  private tokens: number;

  constructor(
    private readonly ratio = 0.1,
    private readonly capacity = 10,
  ) {
    this.tokens = capacity;
  }

  recordRequest(): void {
    this.tokens = Math.min(this.capacity, this.tokens + this.ratio);
  }

  hasToken(): boolean {
    // Cộng dồn 0,1 cho ra 0,999...: sai số số thực không được làm mất một lượt retry.
    return this.tokens >= 1 - 1e-9;
  }

  spend(): void {
    this.tokens = Math.max(0, this.tokens - 1);
  }
}
