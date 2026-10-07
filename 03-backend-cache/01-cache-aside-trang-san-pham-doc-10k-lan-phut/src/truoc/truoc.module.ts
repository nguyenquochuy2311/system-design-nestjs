import { Module } from '@nestjs/common';
import { TruocProductsController } from './products.controller';

@Module({ controllers: [TruocProductsController] })
export class TruocModule {}
