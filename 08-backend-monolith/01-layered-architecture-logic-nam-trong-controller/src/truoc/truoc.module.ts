import { Module } from '@nestjs/common';
import { CsvImportJob } from './csv-import.job';
import { MarketplaceSyncJob } from './marketplace-sync.job';
import { OrdersController } from './orders.controller';

/** Bản "trước": ba đường vào, mỗi đường tự mang quy tắc và SQL của mình. */
@Module({
  controllers: [OrdersController],
  providers: [CsvImportJob, MarketplaceSyncJob],
  exports: [CsvImportJob, MarketplaceSyncJob],
})
export class TruocModule {}
