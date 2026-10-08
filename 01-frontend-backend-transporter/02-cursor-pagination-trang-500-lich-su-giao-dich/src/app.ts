import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { createCursorCodec, InvalidCursorError } from './sau/cursor-codec.js';
import { listTransactionsAfter } from './sau/transactions-keyset.repository.js';
import type { Database } from './shared/db.js';
import type { TransactionDto } from './shared/transaction.js';
import { listTransactionsByPage } from './truoc/transactions-offset.repository.js';

/** Hợp đồng response của bản sau: không có totalPages, chỉ có "còn trang sau hay không". */
export interface CursorPageResponse {
  items: TransactionDto[];
  nextCursor: string | null;
}

export interface AppOptions {
  db: Kysely<Database>;
  cursorSecret: string;
}

const MAX_LIMIT = 100;

function positiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

/**
 * GET /merchants/:merchantId/transactions
 *   ?page=N&size=20      → bản trước (OFFSET), giữ cho app cũ còn gửi page=
 *   ?limit=20&cursor=... → bản sau (keyset); không có cursor là trang đầu
 */
export function buildApp({ db, cursorSecret }: AppOptions): FastifyInstance {
  const codec = createCursorCodec(cursorSecret);
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Params: { merchantId: string }; Querystring: Record<string, string | undefined> }>(
    '/merchants/:merchantId/transactions',
    async (req, reply) => {
      const merchantId = positiveInt(req.params.merchantId, 0);
      if (!merchantId) return reply.code(400).send({ error: 'invalid_merchant' });
      const q = req.query;

      if (q.page !== undefined) {
        const page = positiveInt(q.page, 1);
        const size = positiveInt(q.size, 20);
        if (!page || !size || size > MAX_LIMIT) return reply.code(400).send({ error: 'invalid_page' });
        return listTransactionsByPage(db, merchantId, page, size);
      }

      const limit = positiveInt(q.limit, 20);
      if (!limit || limit > MAX_LIMIT) return reply.code(400).send({ error: 'invalid_limit' });
      let after = null;
      if (q.cursor !== undefined) {
        try {
          after = codec.decode(merchantId, q.cursor);
        } catch (err) {
          if (err instanceof InvalidCursorError) return reply.code(400).send({ error: 'invalid_cursor', message: err.message });
          throw err;
        }
      }
      const page = await listTransactionsAfter(db, merchantId, limit, after);
      const body: CursorPageResponse = { items: page.items, nextCursor: page.next ? codec.encode(merchantId, page.next) : null };
      return body;
    },
  );

  return app;
}
