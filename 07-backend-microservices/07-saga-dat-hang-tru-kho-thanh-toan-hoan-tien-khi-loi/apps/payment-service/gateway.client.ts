/** Kết quả chắc chắn từ cổng. "Chưa biết" không có ở đây: khi đó hàm ném lỗi và lệnh được thử lại, không có trả lời nào. */
export type ChargeOutcome = 'captured' | 'declined';

export class GatewayClient {
  constructor(
    private readonly gatewayUrl: string,
    private readonly timeoutMs: number,
  ) {}

  /**
   * [PATTERN] Timeout không phải thất bại: kết quả chưa biết. Tra cứu theo key rồi mới kết luận; cổng chưa có giao dịch thì
   * ném lỗi để lệnh hiện lại và gửi lại cùng key. Chỉ trả 'declined' khi cổng xác nhận từ chối.
   */
  async charge(key: string, amountVnd: number): Promise<ChargeOutcome> {
    try {
      const response = await fetch(`${this.gatewayUrl}/charges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ amountVnd }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 200) {
        return 'captured';
      }
      if (response.status === 402) {
        return 'declined';
      }
      throw new Error(`Cổng trả ${response.status}`);
    } catch {
      return this.lookup(key);
    }
  }

  private async lookup(key: string): Promise<ChargeOutcome> {
    const response = await fetch(`${this.gatewayUrl}/charges/${key}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (response.status === 404) {
      throw new Error(`Cổng chưa có giao dịch ${key}`);
    }
    const { status } = (await response.json()) as { status: string };
    return status === 'CAPTURED' ? 'captured' : 'declined';
  }

  /** Hoàn tiền nếu đã trừ, khóa key nếu chưa. */
  async void(key: string): Promise<string> {
    const response = await fetch(`${this.gatewayUrl}/charges/${key}/void`, {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 200) {
      throw new Error(`Cổng trả ${response.status} khi hủy`);
    }
    return ((await response.json()) as { status: string }).status;
  }
}
