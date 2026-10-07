import { Body, Controller, Get, Global, Inject, Module, Param, ParseIntPipe, Put, UseGuards, type DynamicModule } from '@nestjs/common';
import { AccountService } from './account.service';
import { CatalogService } from './catalog.service';
import { CONFIG, type Config } from './config';
import { AdminGuard, AuthGuard } from './guards';
import { MediaStore } from './media.store';

/** Đổi giá (dùng cho script đo độ mới của giá qua CDN). Có guard nên cũng nằm trong phép quét route. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Put('products/:id/price')
  setPrice(@Param('id', ParseIntPipe) id: number, @Body() body: { price?: number }) {
    return this.catalog.updatePrice(id, Number(body.price));
  }
}

@Controller('ops')
export class OpsController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Get('health')
  health() {
    return { ok: true, mode: this.config.mode, pid: process.pid };
  }
}

@Global()
@Module({})
export class SharedModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: SharedModule,
      controllers: [AdminController, OpsController],
      providers: [{ provide: CONFIG, useValue: config }, CatalogService, AccountService, MediaStore, AuthGuard, AdminGuard],
      exports: [CONFIG, CatalogService, AccountService, MediaStore, AuthGuard, AdminGuard],
    };
  }
}
