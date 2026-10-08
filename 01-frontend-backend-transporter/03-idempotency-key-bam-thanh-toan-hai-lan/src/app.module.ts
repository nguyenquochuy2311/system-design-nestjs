import { Module } from '@nestjs/common';
import { SauModule } from './sau/sau.module';
import { SharedModule } from './shared/shared.module';
import { TruocModule } from './truoc/truoc.module';

/** Một app chạy cả hai bản để so trên cùng tiến trình: POST /truoc/payments và POST /sau/payments. */
@Module({ imports: [SharedModule, TruocModule, SauModule] })
export class AppModule {}
