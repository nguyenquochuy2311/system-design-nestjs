import { requiredEnv, startService } from '../../libs/platform/service-app';
import { InventoryModule } from './inventory.module';

startService('inventory', InventoryModule.register(requiredEnv('DATABASE_URL')));
