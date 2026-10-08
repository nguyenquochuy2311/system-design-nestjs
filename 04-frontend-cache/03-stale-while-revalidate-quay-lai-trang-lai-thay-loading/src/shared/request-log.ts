// Nhật ký request của API: chỉ số "request /orders mỗi điều phối viên" đếm từ đây (theo cookie uid), không đếm ở
// trình duyệt. Request bị trình duyệt hủy giữa chừng vẫn tính, vì API đã nhận và đã làm việc.
import { appendFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestLine {
  /** Lúc API nhận request (ms). */
  t: number;
  uid: string | null;
  m: string;
  path: string;
  q: string;
  s: number;
  ms: number;
  /** Client đóng kết nối trước khi API trả lời. */
  aborted: boolean;
}

export const uidOf = (req: Request): string | null => /(?:^|;\s*)uid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;

@Injectable()
export class RequestLog {
  readonly lines: RequestLine[] = [];
  file: string | null = null;

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/api/')) return next();
      const t = Date.now();
      const [path = '', q = ''] = req.originalUrl.split('?');
      let done = false;
      const finish = (aborted: boolean) => {
        if (done) return;
        done = true;
        const line: RequestLine = { t, uid: uidOf(req), m: req.method, path, q, s: res.statusCode, ms: Date.now() - t, aborted };
        this.lines.push(line);
        if (this.file) appendFileSync(this.file, `${JSON.stringify(line)}\n`);
      };
      res.on('finish', () => finish(false));
      res.on('close', () => finish(!res.writableFinished));
      next();
    };
  }
}
