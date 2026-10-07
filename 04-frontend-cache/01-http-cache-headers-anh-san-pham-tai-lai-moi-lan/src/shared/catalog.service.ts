import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CATEGORIES,
  IMAGE_VERSION,
  PRODUCT_COUNT,
  categoryOf,
  initialPrice,
  productIds,
  type ProductJson,
} from './catalog-data';

/** Catalog trong bộ nhớ; giá đổi được qua route admin để thấy ETag đổi theo nội dung. */
@Injectable()
export class CatalogService {
  private readonly prices = new Map(productIds().map((id) => [id, initialPrice(id)]));

  list(categorySlug: string): ProductJson[] {
    if (!CATEGORIES.some((c) => c.slug === categorySlug)) throw new NotFoundException(`không có danh mục ${categorySlug}`);
    return productIds()
      .filter((id) => categoryOf(id).slug === categorySlug)
      .map((id) => this.toJson(id));
  }

  get(id: number): ProductJson {
    if (!Number.isInteger(id) || id < 1 || id > PRODUCT_COUNT) throw new NotFoundException(`không có sản phẩm ${id}`);
    return this.toJson(id);
  }

  updatePrice(id: number, price: number): ProductJson {
    this.get(id);
    if (!Number.isInteger(price) || price <= 0) throw new BadRequestException('giá phải là số nguyên dương');
    this.prices.set(id, price);
    return this.toJson(id);
  }

  private toJson(id: number): ProductJson {
    const c = categoryOf(id);
    return {
      id,
      name: `${c.name} mẫu ${String(id).padStart(3, '0')}`,
      category: c.slug,
      price: this.prices.get(id)!,
      currency: 'VND',
      images: { thumb: `/media/${id}/thumb?v=${IMAGE_VERSION}`, large: `/media/${id}/large?v=${IMAGE_VERSION}` },
    };
  }
}
