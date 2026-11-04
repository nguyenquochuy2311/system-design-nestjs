import { requiredEnv, startService } from '../../libs/platform/service-app';
import { OrderServiceModule } from './order-service.module';

startService(
  'order-service',
  OrderServiceModule.register({
    databaseUrl: requiredEnv('DATABASE_URL'),
    deadlineSeconds: Number(process.env.SAGA_DEADLINE_SECONDS ?? 900),
    pollMs: 50,
  }),
);
