/** Đối tác trả lời nhưng không phải thành công. */
export class BankError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`Đối tác trả ${status}`);
  }
}

const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

export type RetryReason = 'timeout' | 'connection' | 'overloaded' | 'rate_limited';

/**
 * [PATTERN] Lỗi nào được retry. Chỉ lỗi thoáng qua; lỗi xác định như 400 có thử lại bao nhiêu lần cũng vậy.
 * Trả undefined nghĩa là không retry.
 */
export function retryReason(error: unknown): RetryReason | undefined {
  if (error instanceof BankError) {
    if (error.status === 503) {
      return 'overloaded';
    }
    return error.status === 429 && error.retryAfterMs !== undefined ? 'rate_limited' : undefined;
  }
  const { name, code } = error as { name?: string; code?: string };
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_ABORTED') {
    return 'timeout';
  }
  return code !== undefined && CONNECTION_ERRORS.has(code) ? 'connection' : undefined;
}
