import { createWriteStream, type WriteStream } from 'node:fs';
import type { ProductItem } from './pages';

/**
 * Chỉ dùng khi đo (WATCH_IDS + WATCH_LOG): mỗi câu trả lời có chứa sản phẩm đang theo dõi ghi một dòng NDJSON
 * {t, k, s, c, p: {id: giá}}. Script đo so giá trong từng dòng với thời điểm đổi giá để đếm request trả giá cũ.
 * Không bật thì record() không làm gì.
 */
export class WatchLog {
  private readonly ids: Set<number>;
  private readonly stream: WriteStream | null;

  constructor(ids: number[], file: string | null) {
    this.ids = new Set(ids);
    this.stream = file && ids.length ? createWriteStream(file, { flags: 'a' }) : null;
  }

  record(key: string, source: string, client: string, items: ProductItem[]): void {
    if (!this.stream) return;
    let prices: Record<number, number> | null = null;
    for (const item of items) {
      if (!this.ids.has(item.id)) continue;
      (prices ??= {})[item.id] = item.price;
    }
    if (prices) this.stream.write(`${JSON.stringify({ t: Date.now(), k: key, s: source, c: client, p: prices })}\n`);
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.stream ? this.stream.end(resolve) : resolve()));
  }
}

export const WATCH_LOG = Symbol('WATCH_LOG');
