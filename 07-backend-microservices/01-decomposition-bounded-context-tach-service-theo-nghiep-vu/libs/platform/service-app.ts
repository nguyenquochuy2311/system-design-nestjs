import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { logEvent } from './log';
import { requestContext } from './request-context';

// Khai báo phần cần dùng thay vì import type từ express (nhật ký 01/03 điểm 6).
interface IncomingRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
}
interface OutgoingResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
  end(body: string): void;
}

function trackRequest(service: string) {
  return (req: IncomingRequest, res: OutgoingResponse, next: () => void): void => {
    if (req.originalUrl === '/healthz') {
      res.end('ok');
      return;
    }
    const header = req.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && header !== '' ? header : randomUUID();
    const startedAt = performance.now();
    res.setHeader('x-correlation-id', correlationId);
    res.on('finish', () => {
      logEvent({
        service,
        correlationId,
        event: 'inbound',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(performance.now() - startedAt),
      });
    });
    requestContext.run({ service, correlationId }, next);
  };
}

export async function createServiceApp(service: string, module: DynamicModule): Promise<INestApplication> {
  const app = await NestFactory.create(module, { logger: ['error', 'warn'] });
  app.use(trackRequest(service));
  return app;
}

export function startService(service: string, module: DynamicModule): void {
  const port = Number(process.env.PORT ?? 3000);
  createServiceApp(service, module)
    .then(async (app) => {
      app.enableShutdownHooks();
      await app.listen(port, '0.0.0.0');
      logEvent({ service, event: 'started', port });
    })
    .catch((error: unknown) => {
      logEvent({ service, event: 'start_failed', error: String(error) });
      process.exit(1);
    });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return value;
}
