import { Module } from '@nestjs/common';
import { CustomerStore } from '../shared/customer-store.js';
import { CustomerPresenter } from './customer.dto.js';
import { CustomersController } from './customers.controller.js';

@Module({ controllers: [CustomersController], providers: [CustomerStore, CustomerPresenter] })
export class TruocAppModule {}
