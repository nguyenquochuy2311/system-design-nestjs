import { Module } from '@nestjs/common';
import { TruocController } from './truoc.controller';

@Module({ controllers: [TruocController] })
export class TruocModule {}
