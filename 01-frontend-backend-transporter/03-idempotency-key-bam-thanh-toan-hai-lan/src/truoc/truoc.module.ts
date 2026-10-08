import { Module } from '@nestjs/common';
import { TruocPaymentsController } from './payments.controller';

@Module({ controllers: [TruocPaymentsController] })
export class TruocModule {}
