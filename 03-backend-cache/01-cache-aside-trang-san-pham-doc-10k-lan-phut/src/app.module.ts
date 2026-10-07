import { Module } from '@nestjs/common';
import { SauModule } from './sau/sau.module';
import { SharedModule } from './shared/shared.module';
import { TruocModule } from './truoc/truoc.module';

/** Một app chạy cả hai bản trên cùng DB: GET /truoc/products/:id (đọc thẳng DB) và GET /sau/products/:id (Cache-Aside). */
@Module({ imports: [SharedModule, TruocModule, SauModule] })
export class AppModule {}
