import { Pool } from 'undici';

export interface PricingClientOptions {
  timeoutMs: number;
  /** Phải đặt riêng: `signal` không hủy được request đang xếp hàng chờ kết nối, mặc định của undici là 10 giây. */
  connectTimeoutMs: number;
  /** Tuổi tối đa của một kết nối; 0 là không giới hạn. */
  maxConnectionAgeMs: number;
  /** Số lần gửi lại khi kết nối hỏng. */
  retries: number;
}

export interface Quote {
  pod: string;
  priceVnd: number;
}

/**
 * Bản "trước" truyền vào danh sách IP và chia vòng tròn. Bản "sau" truyền đúng một tên Service: phía gọi không còn biết pod nào.
 *
 * [PATTERN] kube-proxy chia theo kết nối chứ không theo request: giữ keep-alive mãi thì pod mới không nhận tải, và pod đã bị gỡ
 * khỏi EndpointSlice vẫn nhận request. Giới hạn tuổi kết nối buộc client mở lại kết nối, tức đi qua Service lại.
 */
export class PricingClient {
  private readonly pools: Pool[];
  private next = 0;

  constructor(
    targets: string[],
    private readonly options: PricingClientOptions,
  ) {
    this.pools = targets.map(
      (target) =>
        new Pool(target, {
          connections: 4,
          connect: { timeout: options.connectTimeoutMs },
          ...(options.maxConnectionAgeMs > 0 ? { clientTtl: options.maxConnectionAgeMs } : {}),
        }),
    );
  }

  private pickPool(): Pool {
    const pool = this.pools[this.next % this.pools.length] as Pool;
    this.next += 1;
    return pool;
  }

  private async attempt(km: number): Promise<Quote> {
    const { statusCode, body } = await this.pickPool().request({
      path: `/quote?km=${km}`,
      method: 'GET',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (statusCode !== 200) {
      await body.dump();
      throw new Error(`pricing trả ${statusCode}`);
    }
    return (await body.json()) as Quote;
  }

  /** GET idempotent nên gửi lại được: kết nối cũ bị pod đang tắt đóng thì mở kết nối mới qua Service. */
  async quote(km: number): Promise<Quote> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt(km);
      } catch (error) {
        if (attempt >= this.options.retries) {
          throw error;
        }
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.pools.map((pool) => pool.destroy()));
  }
}
