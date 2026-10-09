// bank-adapter: worker BullMQ tiêu thụ job "charge", gọi ngân hàng (giả lập), rồi báo ledger xác nhận hoặc đảo bút toán.
// Mã worker chỉ biết job (job_id, số thẻ, số tiền) — không tự log topup_id; bản sau vẫn nối được nhờ trace_id.
import { Worker, type Job } from 'bullmq';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { processWithContext, setupLogging } from '../../packages/logging/index.js';
import { listenPort, postJson } from '../shared/http.js';

const log = setupLogging('bank-adapter');
const LEDGER_URL = process.env.LEDGER_URL ?? 'http://ledger:3103';
const QUEUE = 'bank-charge';
const TIMEOUT_BANK = process.env.TIMEOUT_BANK_CODE ?? 'SIMBANK_TIMEOUT';
const BANK_DELAY_MS = Number(process.env.BANK_DELAY_MS ?? 20);

interface ChargeJob {
  topup_id: string;
  amount: number;
  bank_code: string;
  card_number: string;
  phone: string;
}

/** Ngân hàng giả lập: mã ngân hàng TIMEOUT_BANK luôn timeout; lỗi của "SDK ngân hàng" có số thuê bao trong message. */
async function chargeBank(job: ChargeJob): Promise<string> {
  await new Promise((r) => setTimeout(r, BANK_DELAY_MS));
  if (job.bank_code === TIMEOUT_BANK) {
    throw new Error(`${job.bank_code} timeout sau 3000ms (thuê bao ${job.phone}, thẻ ${job.card_number}, số tiền ${job.amount})`);
  }
  return `BR${Date.now().toString(36)}`;
}

const connection = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', { maxRetriesPerRequest: null });
const worker = new Worker<ChargeJob>(
  QUEUE,
  async (job: Job<ChargeJob>) =>
    // [PATTERN] Khôi phục trace context từ job trước khi làm bất cứ gì (kể cả log dòng đầu tiên).
    processWithContext(QUEUE, job, async () => {
      const { topup_id, amount, bank_code, card_number } = job.data;
      log.info('bank.charge_started', 'gọi ngân hàng', { job_id: job.id, bank_code, amount, card_number });
      try {
        const bank_ref = await chargeBank(job.data);
        log.info('bank.charge_succeeded', 'ngân hàng chấp nhận', { job_id: job.id, bank_ref });
        await postJson(`${LEDGER_URL}/entries/${topup_id}/confirm`, { bank_ref });
      } catch (err) {
        log.error('bank.charge_failed', 'gọi ngân hàng thất bại', { err, job_id: job.id });
        await postJson(`${LEDGER_URL}/entries/${topup_id}/reverse`, { reason: 'bank_timeout' });
      }
    }),
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 20) },
);

const app = Fastify({ logger: false });
app.get('/healthz', async () => ({ ok: worker.isRunning() }));
const port = listenPort(3102);
await app.listen({ host: '0.0.0.0', port });
log.info('service.started', `worker ${QUEUE} chạy, health ở cổng ${port}`);
process.on('SIGTERM', async () => {
  await worker.close();
  await app.close();
  connection.disconnect();
  process.exit(0);
});
