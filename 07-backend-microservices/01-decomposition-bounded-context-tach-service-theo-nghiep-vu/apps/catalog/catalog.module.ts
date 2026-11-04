import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  type DynamicModule,
} from '@nestjs/common';
import { Database } from '../../libs/platform/database';
import { toPublishedEvent, type ChangedProduct, type EventSchema } from './published-event';

export interface CatalogConfig {
  databaseUrl: string;
  eventSchema: EventSchema;
}

const CATALOG_CONFIG = Symbol('CATALOG_CONFIG');

@Injectable()
class PriceChangeService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  changePrice(sku: string, priceVnd: number): Promise<ChangedProduct> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<ChangedProduct>(
        `UPDATE catalog.products SET list_price_vnd = $2, price_version = price_version + 1 WHERE sku = $1
         RETURNING sku, display_name, list_price_vnd, price_version`,
        [sku, priceVnd],
      );
      const product = rows[0];
      if (!product) {
        throw new NotFoundException(`Không có sản phẩm ${sku}`);
      }
      // [PATTERN] Catalog chỉ thông báo sự kiện và không biết ai tiêu thụ. Gửi cùng transaction với việc đổi giá nên
      // không có giá đổi mà thiếu sự kiện; PGMQ nằm trong cùng PostgreSQL mới làm được vậy (xem 14/03 khi tách máy).
      await tx.query("SELECT pgmq.send('catalog_events', $1::jsonb)", [
        JSON.stringify(toPublishedEvent(product, this.config.eventSchema)),
      ]);
      return product;
    });
  }
}

@Controller('products')
class ProductController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PriceChangeService) private readonly priceChange: PriceChangeService,
  ) {}

  @Get(':sku')
  async get(@Param('sku') sku: string) {
    const { rows } = await this.db.query('SELECT * FROM catalog.products WHERE sku = $1', [sku]);
    if (!rows[0]) {
      throw new NotFoundException(`Không có sản phẩm ${sku}`);
    }
    return rows[0];
  }

  @Patch(':sku/price')
  changePrice(@Param('sku') sku: string, @Body() body: { priceVnd: number }) {
    if (!Number.isInteger(body.priceVnd) || body.priceVnd <= 0) {
      throw new BadRequestException('priceVnd phải là số nguyên dương');
    }
    return this.priceChange.changePrice(sku, body.priceVnd);
  }
}

@Module({})
export class CatalogModule {
  static register(config: CatalogConfig): DynamicModule {
    return {
      module: CatalogModule,
      controllers: [ProductController],
      providers: [
        PriceChangeService,
        { provide: CATALOG_CONFIG, useValue: config },
        { provide: Database, useFactory: () => new Database(config.databaseUrl) },
      ],
    };
  }
}
