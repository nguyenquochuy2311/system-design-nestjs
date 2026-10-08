import { Module } from '@nestjs/common';
import { LoginMd5Service } from './login-md5.service';
import { TruocController } from './truoc.controller';

@Module({ controllers: [TruocController], providers: [LoginMd5Service] })
export class TruocModule {}
