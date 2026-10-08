import { Module } from '@nestjs/common';
import { FailedLoginCounter } from './failed-login-counter';
import { LegacyHashAdapter } from './legacy-hash-adapter';
import { LoginService } from './login.service';
import { PasswordHasher } from './password-hasher';
import {
  HASHER_OPTIONS,
  LOGIN_OPTIONS,
  hasherOptionsFromEnv,
  loginOptionsFromEnv,
} from './password-hasher.options';
import { SauController } from './sau.controller';

@Module({
  controllers: [SauController],
  providers: [
    { provide: HASHER_OPTIONS, useFactory: hasherOptionsFromEnv },
    { provide: LOGIN_OPTIONS, useFactory: loginOptionsFromEnv },
    PasswordHasher,
    LegacyHashAdapter,
    FailedLoginCounter,
    LoginService,
  ],
  exports: [PasswordHasher, LegacyHashAdapter],
})
export class SauModule {}
