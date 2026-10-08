import { Module } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { SauController } from './sau.controller';
import { SessionGuard } from './session.guard';
import { SessionRevoker } from './session-revoker';

@Module({
  controllers: [SauController],
  providers: [SessionRevoker, SessionGuard, CsrfGuard],
  exports: [SessionRevoker],
})
export class SauModule {}
