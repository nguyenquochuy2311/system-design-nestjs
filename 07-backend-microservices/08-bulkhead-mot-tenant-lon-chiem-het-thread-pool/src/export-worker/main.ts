import { requiredEnv } from '../shared/service-app';
import { startExportWorker } from './worker';

startExportWorker(requiredEnv('DATABASE_URL'), Number(process.env.REPORT_SECONDS ?? 5), 100);
