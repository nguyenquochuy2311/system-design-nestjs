import { requiredEnv, startService } from '../shared/service-app';
import { CrmModule } from './crm.module';

startService(
  'crm-api',
  CrmModule.register({
    mode: process.env.CRM_MODE === 'truoc' ? 'truoc' : 'sau',
    databaseUrl: requiredEnv('DATABASE_URL'),
    reportSeconds: Number(process.env.REPORT_SECONDS ?? 5),
  }),
);
