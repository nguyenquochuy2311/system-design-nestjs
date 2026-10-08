/** Dựng backend (bản trước/sau) trong tiến trình test, nghe cổng ngẫu nhiên, cho phép thay provider qua DI. */
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { SauAppModule } from '../../apps/backend/src/sau/app.module.js';
import { TruocAppModule } from '../../apps/backend/src/truoc/app.module.js';

export interface RunningApi {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startApi(
  variant: 'truoc' | 'sau',
  overrides: Array<{ provide: Type<unknown>; useValue: unknown }> = [],
): Promise<RunningApi> {
  let builder = Test.createTestingModule({ imports: [variant === 'truoc' ? TruocAppModule : SauAppModule] });
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}
