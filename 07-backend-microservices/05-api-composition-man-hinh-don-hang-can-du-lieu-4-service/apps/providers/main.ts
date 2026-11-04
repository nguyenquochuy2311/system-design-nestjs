import { requiredEnv, startService } from '../../libs/platform/service-app';
import { isProviderName, ProviderModule } from './providers.module';

const name = requiredEnv('SERVICE_NAME');
if (!isProviderName(name)) {
  throw new Error(`Không có service ${name}`);
}

startService(
  name,
  ProviderModule.register(name, requiredEnv('DATABASE_URL'), {
    delayMs: Number(process.env.PROVIDER_DELAY_MS ?? 40),
    failing: false,
    requests: 0,
  }),
);
