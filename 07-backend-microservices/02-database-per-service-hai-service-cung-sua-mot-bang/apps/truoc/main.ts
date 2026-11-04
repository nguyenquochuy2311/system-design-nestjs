import { requiredEnv, startService } from '../../libs/platform/service-app';
import { TruocOrderModule, TruocShippingModule } from './truoc.module';

const name = requiredEnv('SERVICE_NAME');
const databaseUrl = requiredEnv('DATABASE_URL');

if (name === 'truoc-order') {
  startService(name, TruocOrderModule.register(databaseUrl));
} else if (name === 'truoc-shipping') {
  startService(name, TruocShippingModule.register(databaseUrl));
} else {
  throw new Error(`Không có service ${name}`);
}
