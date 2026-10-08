import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CustomerStore } from '../shared/customer-store.js';
import { ErrorResponseFilter } from './contract.js';
import { CustomerPresenter } from './customer.presenter.js';
import { CustomersController } from './customers.controller.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomerStore, CustomerPresenter, { provide: APP_FILTER, useClass: ErrorResponseFilter }],
})
export class SauAppModule {}
