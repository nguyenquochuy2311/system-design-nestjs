import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_SIZES, type ImageSize } from './catalog-data';
import { CONFIG, type Config } from './config';

export interface MediaFile {
  buffer: Buffer;
  contentType: 'image/webp' | 'image/jpeg';
}

/**
 * media-service: ảnh sản phẩm sinh sẵn bằng `pnpm media:seed` (.data/media/<id>-<size>.<webp|jpg>), nạp hết vào bộ nhớ
 * lúc khởi động. Cùng một URL trả WebP hay JPEG tùy header Accept của trình duyệt (content negotiation).
 */
@Injectable()
export class MediaStore implements OnModuleInit {
  private readonly files = new Map<string, MediaFile>();

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  onModuleInit(): void {
    for (const name of readdirSync(this.config.mediaDir)) {
      const m = /^(\d+)-(thumb|large)\.(webp|jpg)$/.exec(name);
      if (!m) continue;
      this.files.set(`${m[1]}-${m[2]}-${m[3]}`, {
        buffer: readFileSync(join(this.config.mediaDir, name)),
        contentType: m[3] === 'webp' ? 'image/webp' : 'image/jpeg',
      });
    }
    if (this.files.size === 0) throw new Error(`không có ảnh trong ${this.config.mediaDir}: chạy pnpm media:seed`);
  }

  /** Chọn biến thể theo Accept: trình duyệt nhận WebP thì trả WebP, còn lại JPEG. */
  pick(id: number, size: string, accept: string | undefined): MediaFile {
    if (!(size in IMAGE_SIZES)) throw new NotFoundException(`không có cỡ ảnh ${size}`);
    const format = /\bimage\/webp\b/.test(accept ?? '') ? 'webp' : 'jpg';
    const file = this.files.get(`${id}-${size as ImageSize}-${format}`);
    if (!file) throw new NotFoundException(`không có ảnh ${id}/${size}`);
    return file;
  }
}
