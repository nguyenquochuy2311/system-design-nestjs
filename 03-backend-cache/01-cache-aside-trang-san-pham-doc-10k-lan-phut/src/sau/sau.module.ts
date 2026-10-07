import { Module } from '@nestjs/common';
import { ProductCache } from './product.cache';
import { SauProductsController } from './products.controller';
import { ProductService } from './product.service';

@Module({ controllers: [SauProductsController], providers: [ProductCache, ProductService] })
export class SauModule {}
