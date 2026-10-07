import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from './shared/db';
import { ContractNotFoundError, type ContractPatch, type NewContract } from './shared/contract';
import type { Actor } from './sau/with-actor';
import * as sau from './sau/contract.repository';
import { fieldHistory } from './sau/audit-query';
import { createContractTruoc, deleteContractTruoc, findContractTruoc, updateContractTruoc } from './truoc/contract.repository';
import { updateContractAppLogged } from './truoc/contract.app-logged.repository';

/**
 * API hợp đồng. `?mode=` chọn phiên bản để so sánh trên cùng một API:
 *   truoc   : schema truoc, UPDATE ghi đè, DELETE xóa cứng (hệ thống hiện tại)
 *   app-log : schema truoc, repository tự ghi nhật ký (phương án so sánh, chỉ có ở PATCH)
 *   sau     : schema public, Audit Log bằng trigger + Soft Delete (mặc định)
 * Header `x-user` là người thực hiện (lab không có đăng nhập), `x-request-id` tùy chọn; lý do đi trong body
 * (`reason`) vì header HTTP không chứa được tiếng Việt có dấu.
 */
type Mode = 'truoc' | 'app-log' | 'sau';

class BadRequestError extends Error {}

const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] } as const;
const modeQuery = (modes: Mode[]) => ({ type: 'object', properties: { mode: { type: 'string', enum: modes } } }) as const;
const reason = { type: 'string', maxLength: 500 } as const;

const patchBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    customerName: { type: 'string', minLength: 1 },
    product: { type: 'string', minLength: 1 },
    premium: { type: 'integer', minimum: 0 },
    sumInsured: { type: 'integer', minimum: 1 },
    endDate: { type: 'string', format: 'date' },
    reason,
  },
} as const;

const createBody = {
  type: 'object',
  required: ['code', 'customerName', 'product', 'premium', 'sumInsured', 'startDate', 'endDate'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1 },
    customerName: { type: 'string', minLength: 1 },
    product: { type: 'string', minLength: 1 },
    premium: { type: 'integer', minimum: 0 },
    sumInsured: { type: 'integer', minimum: 1 },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
    reason,
  },
} as const;

function actorOf(req: FastifyRequest, reasonText?: string): Actor {
  const userId = req.headers['x-user'];
  if (typeof userId !== 'string' || !userId.trim()) throw new BadRequestError('Thiếu header x-user (người thực hiện)');
  const requestId = req.headers['x-request-id'];
  return { userId, reason: reasonText, requestId: typeof requestId === 'string' ? requestId : req.id };
}

export function buildApp(db: Kysely<Database>, opts: { logLevel?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logLevel ? { level: opts.logLevel } : false });

  app.setErrorHandler((err: Error & { code?: string; statusCode?: number }, req, reply) => {
    if (err instanceof ContractNotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof BadRequestError) return reply.code(400).send({ error: 'bad_request', message: err.message });
    if (err.code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'Mã hợp đồng đang được dùng bởi hợp đồng còn hiệu lực' });
    if (err.code === '23503') return reply.code(409).send({ error: 'referenced', message: 'Hợp đồng còn hồ sơ bồi thường tham chiếu' });
    if (!err.statusCode || err.statusCode >= 500) req.log.error({ err, url: req.url, user: req.headers['x-user'] }, 'lỗi xử lý request');
    return reply.send(err);
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.post<{ Querystring: { mode?: Mode }; Body: NewContract & { reason?: string } }>(
    '/contracts',
    { schema: { querystring: modeQuery(['truoc', 'sau']), body: createBody } },
    async (req, reply) => {
      const { reason: why, ...input } = req.body;
      const actor = actorOf(req, why);
      const created = req.query.mode === 'truoc' ? await createContractTruoc(db, actor.userId, input) : await sau.createContract(db, actor, input);
      return reply.code(201).send(created);
    },
  );

  app.get<{ Params: { id: number }; Querystring: { mode?: Mode } }>(
    '/contracts/:id',
    { schema: { params: idParams, querystring: modeQuery(['truoc', 'sau']) } },
    async (req) => {
      const found = req.query.mode === 'truoc' ? await findContractTruoc(db, req.params.id) : await sau.findContract(db, req.params.id);
      if (!found) throw new ContractNotFoundError(req.params.id);
      return found;
    },
  );

  app.patch<{ Params: { id: number }; Querystring: { mode?: Mode }; Body: ContractPatch & { reason?: string } }>(
    '/contracts/:id',
    { schema: { params: idParams, querystring: modeQuery(['truoc', 'app-log', 'sau']), body: patchBody } },
    async (req) => {
      const { reason: why, ...patch } = req.body;
      const actor = actorOf(req, why);
      switch (req.query.mode ?? 'sau') {
        case 'truoc':
          return updateContractTruoc(db, actor.userId, req.params.id, patch);
        case 'app-log':
          return updateContractAppLogged(db, actor.userId, req.params.id, patch);
        case 'sau':
          return sau.updateContract(db, actor, req.params.id, patch);
      }
    },
  );

  app.delete<{ Params: { id: number }; Querystring: { mode?: Mode }; Body: { reason?: string } | undefined }>(
    '/contracts/:id',
    { schema: { params: idParams, querystring: modeQuery(['truoc', 'sau']) } },
    async (req, reply) => {
      const actor = actorOf(req, req.body?.reason);
      if (req.query.mode === 'truoc') await deleteContractTruoc(db, req.params.id);
      else await sau.softDeleteContract(db, actor, req.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: number }; Body: { reason?: string } | undefined }>(
    '/contracts/:id/restore',
    { schema: { params: idParams } },
    async (req) => sau.restoreContract(db, actorOf(req, req.body?.reason), req.params.id),
  );

  // Câu hỏi của kiểm toán: ai đổi trường X của hợp đồng này, lúc nào, từ bao nhiêu sang bao nhiêu, vì sao.
  app.get<{ Params: { id: number }; Querystring: { field?: string } }>(
    '/contracts/:id/history',
    {
      schema: {
        params: idParams,
        querystring: { type: 'object', properties: { field: { type: 'string', pattern: '^[a-z_]{1,40}$' } } },
      },
    },
    async (req) => fieldHistory(db, 'contracts', req.params.id, req.query.field ?? 'premium'),
  );

  app.get<{ Querystring: { product: string } }>(
    '/reports/premium',
    { schema: { querystring: { type: 'object', required: ['product'], properties: { product: { type: 'string' } } } } },
    async (req) => sau.premiumReport(db, req.query.product),
  );

  return app;
}
