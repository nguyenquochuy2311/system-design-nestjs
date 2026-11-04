import { requiredEnv, startService } from '../../libs/platform/service-app';
import { PaymentServiceModule } from './payment-service.module';

startService(
  'payment-service',
  PaymentServiceModule.register({
    databaseUrl: requiredEnv('DATABASE_URL'),
    gatewayUrl: requiredEnv('GATEWAY_URL'),
    gatewayTimeoutMs: Number(process.env.GATEWAY_TIMEOUT_MS ?? 1_000),
    pollMs: 50,
    visibilitySeconds: 5,
  }),
);
