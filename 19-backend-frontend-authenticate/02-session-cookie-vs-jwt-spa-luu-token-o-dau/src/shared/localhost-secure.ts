import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Lab shim: chỉ cho request có Host là localhost (trình duyệt coi đó là secure context, đã kiểm Chrome 154 chấp nhận
 * cookie Secure/__Host- qua http://localhost). Báo cho express-session biết kết nối là secure để nó PHÁT cookie Secure
 * mà không cần dựng HTTPS. Host khác giữ nguyên, nên bật nhầm sau proxy thật cũng không biến http thành "https".
 * Chỉ bật khi TRUST_LOCALHOST_SECURE=1 (mặc định tắt); chạy sau TLS thật thì không cần.
 */
export function localhostSecureShim(req: Request, _res: Response, next: NextFunction): void {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (LOCAL_HOSTS.has(host)) req.headers['x-forwarded-proto'] = 'https';
  next();
}
