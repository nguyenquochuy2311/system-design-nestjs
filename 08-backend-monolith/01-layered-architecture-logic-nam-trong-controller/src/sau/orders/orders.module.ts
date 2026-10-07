import { Module } from '@nestjs/common';
import { ORDER_UNIT_OF_WORK } from './application/order-repository';
import { PlaceOrderService } from './application/place-order.service';
import { KyselyOrderUnitOfWork } from './infrastructure/kysely-order-repository';
import { CsvImportJob } from './presentation/csv-import.job';
import { MarketplaceSyncJob } from './presentation/marketplace-sync.job';
import { OrdersController } from './presentation/orders.controller';

/**
 * Bản "sau": module NestJS là nơi duy nhất ghép các lớp với nhau (composition root).
 * Test thay ORDER_UNIT_OF_WORK bằng bản trong bộ nhớ qua overrideProvider, không cần DB.
 */
@Module({
  controllers: [OrdersController],
  providers: [
    PlaceOrderService,
    CsvImportJob,
    MarketplaceSyncJob,
    { provide: ORDER_UNIT_OF_WORK, useClass: KyselyOrderUnitOfWork },
  ],
  exports: [CsvImportJob, MarketplaceSyncJob],
})
export class OrdersModule {}
