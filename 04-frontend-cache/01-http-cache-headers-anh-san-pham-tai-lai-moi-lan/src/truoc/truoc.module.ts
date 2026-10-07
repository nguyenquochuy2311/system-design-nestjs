import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { MediaController, ProductsController } from './catalog.controller';

@Module({ controllers: [ProductsController, MediaController, AccountController] })
export class TruocModule {}
