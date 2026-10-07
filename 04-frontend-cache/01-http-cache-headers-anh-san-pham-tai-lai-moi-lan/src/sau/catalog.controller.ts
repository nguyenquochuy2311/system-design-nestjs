import { Controller, Get, Headers, Inject, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CatalogService } from '../shared/catalog.service';
import { MediaStore } from '../shared/media.store';
import { CachePolicy, etagFor } from './cache-policy';

@Controller('api/products')
@CachePolicy('public-json')
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
@CachePolicy('media')
export class MediaController {
  /** ETag của mỗi file tính một lần (hash 24–190 KB mỗi request là tốn CPU vô ích). */
  private readonly etags = new WeakMap<Buffer, string>();

  constructor(@Inject(MediaStore) private readonly media: MediaStore) {}

  @Get(':id/:size')
  image(@Param('id', ParseIntPipe) id: number, @Param('size') size: string, @Headers('accept') accept: string | undefined, @Res() res: Response): void {
    const file = this.media.pick(id, size, accept);
    let etag = this.etags.get(file.buffer);
    if (!etag) {
      etag = etagFor(file.buffer);
      this.etags.set(file.buffer, etag);
    }
    // [PATTERN] Cùng URL nhưng WebP hay JPEG tùy Accept: Vary bắt mọi cache tách bản lưu theo Accept.
    res.setHeader('Vary', 'Accept');
    res.setHeader('ETag', etag);
    // Express trả 304 không body khi If-None-Match khớp ETag vừa đặt.
    res.type(file.contentType).send(file.buffer);
  }
}
