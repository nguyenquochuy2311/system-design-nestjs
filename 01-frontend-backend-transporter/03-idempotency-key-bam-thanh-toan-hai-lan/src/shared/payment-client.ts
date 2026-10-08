import { randomUUID } from 'node:crypto';
import http from 'node:http';

export interface HttpReply {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Thân response nguyên byte (chuỗi UTF-8), để so "giống hệt" giữa lần đầu và lần phát lại. */
  body: string;
}

/**
 * POST JSON bằng node:http, mỗi lần một kết nối mới, hết `timeoutMs` thì hủy. Mặc định `Connection: close`;
 * `keepAlive` để server không tự đóng kết nối sau response (response bị nuốt thì client phải chờ hết giờ).
 */
export function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, keepAlive = false): Promise<HttpReply> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: keepAlive ? 'keep-alive' : 'close', ...headers },
    });
    const timer = setTimeout(() => req.destroy(new Error(`timeout ${timeoutMs} ms`)), timeoutMs);
    req.once('error', (err) => (clearTimeout(timer), reject(err)));
    req.once('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.once('error', (err) => (clearTimeout(timer), reject(err)));
      res.once('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.end(payload);
  });
}

export interface PaymentIntent {
  userId: string;
  merchantId: number;
  amount: number;
  /** Mã ý định thanh toán phía app (ví dụ mã hóa đơn hiển thị); lab dùng để đối soát số giao dịch. */
  note: string;
}

export interface AttemptLog {
  attempt: number;
  key: string;
  status?: number;
  error?: string;
}

export interface PayOutcome {
  status: number;
  body: string;
  replayed: boolean;
  attempts: AttemptLog[];
}

export interface PaymentClientOptions {
  baseUrl: string;
  /** `/truoc/payments` hoặc `/sau/payments`. */
  path: string;
  /** App thật chờ 10 giây; lab rút ngắn để chạy nhanh. */
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
  keepAlive?: boolean;
}

/**
 * Client giả lập app di động: gửi lại khi lỗi mạng, hết giờ, 409 hay 5xx. Hai bản server dùng chung client này.
 * `beforeAttempt` cho bộ đo bật/tắt toxic của Toxiproxy trước từng lần gửi.
 */
export class PaymentClient {
  constructor(private readonly opts: PaymentClientOptions) {}

  async pay(intent: PaymentIntent, beforeAttempt?: (attempt: number) => Promise<void>): Promise<PayOutcome> {
    const attempts: AttemptLog[] = [];
    // [PATTERN] Khóa gắn với ý định thanh toán: sinh một lần, giữ nguyên qua mọi lần gửi lại.
    const key = randomUUID();
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      await beforeAttempt?.(attempt);
      const log: AttemptLog = { attempt, key };
      attempts.push(log);
      try {
        const reply = await postJson(
          `${this.opts.baseUrl}${this.opts.path}`,
          // Bản nháp IETF: giá trị là Structured Field kiểu String, có ngoặc kép.
          { 'Idempotency-Key': `"${key}"`, 'X-User-Id': intent.userId },
          { merchantId: intent.merchantId, amount: intent.amount, note: intent.note },
          this.opts.timeoutMs,
          this.opts.keepAlive,
        );
        log.status = reply.status;
        if (reply.status !== 409 && reply.status < 500) {
          return { status: reply.status, body: reply.body, replayed: reply.headers['idempotent-replayed'] === 'true', attempts };
        }
      } catch (err) {
        log.error = (err as Error).message;
      }
      await new Promise((r) => setTimeout(r, this.opts.backoffMs * attempt));
    }
    throw Object.assign(new Error(`Hết ${this.opts.maxAttempts} lần thử cho ${intent.note}`), { attempts });
  }
}
