import { Module } from '@nestjs/common';
import { OrdersModule } from './sau/orders/orders.module';
import { SharedModule } from './shared/shared.module';
import { TruocModule } from './truoc/truoc.module';

/** Một app chạy cả hai bản để so trên cùng tiến trình: POST /truoc/orders và POST /sau/orders. */
@Module({ imports: [SharedModule, TruocModule, OrdersModule] })
export class AppModule {}
