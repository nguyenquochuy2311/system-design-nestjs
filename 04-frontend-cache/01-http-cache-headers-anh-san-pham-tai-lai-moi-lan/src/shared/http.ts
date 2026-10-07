import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { createWriteStream } from 'node:fs';
import type { Config } from './config';

/**
 * Cấu hình Express dùng chung cho hai bản.
 * - Tắt ETag tự sinh của Express (mặc định 'weak' cho mọi res.send): ETag của bản sau chỉ đến từ bảng chính sách,
 *   nên phép thử âm gỡ ETag khỏi chính sách mới làm test đỏ được. Bản trước vì vậy không có ETag nào.
 * - Mặc định no-store cho MỌI response từ lúc request vào (cả 401 của guard, 404, lỗi pipe). Ở bản trước đây chính là
 *   thiết lập "cho chắc" của đợt rà soát bảo mật; ở bản sau là mặc định an toàn mà interceptor ghi đè theo chính sách.
 * - ACCESS_LOG: mỗi request tới máy chủ gốc một dòng JSON, để đếm "request tới gốc mỗi phút".
 */
export function configureHttp(app: NestExpressApplication, config: Config): void {
  app.set('etag', false);
  app.disable('x-powered-by');
  if (config.accessLog) {
    const log = createWriteStream(config.accessLog, { flags: 'a' });
    app.use((req: Request, res: Response, next: NextFunction) => {
      const t = Date.now();
      res.on('finish', () => {
        log.write(`${JSON.stringify({ t, m: req.method, u: req.originalUrl, s: res.statusCode, inm: req.headers['if-none-match'] ?? null })}\n`);
      });
      next();
    });
  }
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}
