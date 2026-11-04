import { requiredEnv, startService } from '../../libs/platform/service-app';
import { CatalogModule } from './catalog.module';

startService(
  'catalog',
  CatalogModule.register({
    databaseUrl: requiredEnv('DATABASE_URL'),
    eventSchema: process.env.CATALOG_EVENT_SCHEMA === 'v2' ? 'v2' : 'v1',
  }),
);
