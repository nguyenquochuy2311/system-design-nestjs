import { Controller, Get, Headers, Inject, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CatalogService } from '../shared/catalog.service';
import { MediaStore } from '../shared/media.store';

// Hiện trạng: không route nào khai báo chính sách; middleware "bảo mật" (src/shared/http.ts) đặt no-store cho mọi
// response, không có ETag. Mỗi lượt xem tải lại toàn bộ JSON và ảnh từ máy chủ gốc.
@Controller('api/products')
export class ProductsController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  list(@Query('category') category: string | undefined) {
    return this.catalog.list(category ?? '');
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.get(id);
  }
}

@Controller('media')
export class MediaController {
  constructor(@Inject(MediaStore) private readonly media: MediaStore) {}

  @Get(':id/:size')
  image(@Param('id', ParseIntPipe) id: number, @Param('size') size: string, @Headers('accept') accept: string | undefined, @Res() res: Response): void {
    const file = this.media.pick(id, size, accept);
    // Không có Vary dù nội dung đổi theo Accept: chưa lộ ra vì no-store, sẽ lộ ngay khi ai đó bật cache.
    res.type(file.contentType).send(file.buffer);
  }
}
