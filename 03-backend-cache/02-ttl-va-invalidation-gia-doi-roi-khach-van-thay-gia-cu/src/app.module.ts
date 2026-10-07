import { Module } from '@nestjs/common';
import { SauModule } from './sau/sau.module';
import { SharedModule } from './shared/shared.module';
import { ShopController } from './shop.controller';
import { TruocModule } from './truoc/truoc.module';

/** Một API chạy cả hai bản trên cùng DB và Redis (key khác tiền tố): /truoc/... và /sau/... */
@Module({ imports: [SharedModule, TruocModule, SauModule], controllers: [ShopController] })
export class AppModule {}
