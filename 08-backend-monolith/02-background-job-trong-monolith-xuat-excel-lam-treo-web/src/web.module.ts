import { Module } from '@nestjs/common';
import { ExportsModule } from './sau/exports/exports.module';
import { OrdersController } from './shared/orders.controller';
import { RuntimeMetricsController } from './shared/runtime-metrics';
import { SharedModule } from './shared/shared.module';
import { TruocModule } from './truoc/truoc.module';

/**
 * Process type `web`: API tạo đơn, health check, xuất Excel kiểu cũ (`/truoc/reports/orders.xlsx`)
 * và xuất kiểu mới (`/exports`). Một app chạy cả hai bản để so trên cùng tiến trình.
 */
@Module({
  imports: [SharedModule, TruocModule, ExportsModule],
  controllers: [OrdersController, RuntimeMetricsController],
})
export class WebModule {}
