import type { NextFunction, Request, Response } from 'express';
import { createWriteStream } from 'node:fs';

/**
 * Nhật ký mỗi request một dòng JSON: phiên bản client (X-App-Version), tab (X-Tab-Id), người dùng (cookie uid do script
 * đo đặt) và các trường controller gắn thêm vào res.locals.log (ghi chú bị mất, lỗi phía client...).
 * Đây là "log X-App-Version ở API" của mục 5: đếm request từ bản cũ sau deploy.
 */
export function requestLogger(file: string) {
  const out = createWriteStream(file, { flags: 'a' });
  return (req: Request, res: Response, next: NextFunction) => {
    const t = Date.now();
    res.on('finish', () => {
      const uid = /(?:^|;\s*)uid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
      out.write(
        `${JSON.stringify({ t, m: req.method, u: req.originalUrl, s: res.statusCode, v: req.header('x-app-version') ?? null, tab: req.header('x-tab-id') ?? null, uid, ...(res.locals.log as object | undefined) })}\n`,
      );
    });
    next();
  };
}
