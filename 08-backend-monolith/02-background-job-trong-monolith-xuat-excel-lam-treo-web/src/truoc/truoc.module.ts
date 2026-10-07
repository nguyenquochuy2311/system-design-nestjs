import { Module } from '@nestjs/common';
import { OrdersXlsxController } from './orders-xlsx.controller';

@Module({ controllers: [OrdersXlsxController] })
export class TruocModule {}
