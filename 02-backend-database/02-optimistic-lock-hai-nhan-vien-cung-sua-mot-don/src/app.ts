import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from './shared/db';
import { ConcurrentModificationError, getShipment, ShipmentNotFoundError, type ShipmentForm } from './shared/shipment';
import { saveShipmentLastWriteWins } from './truoc/shipment.last-write-wins';
import { saveShipmentSelectForUpdate } from './truoc/shipment.select-for-update';
import { saveShipmentCheckThenWrite } from './truoc/shipment.check-then-write';
import { saveShipment } from './sau/shipment.repository';

export const SAVE_MODES = ['lww', 'for-update', 'check-then-write', 'version'] as const;
type SaveMode = (typeof SAVE_MODES)[number];

interface SaveBody extends ShipmentForm {
  version?: number;
}

const saveSchema = {
  params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] },
  querystring: { type: 'object', properties: { mode: { type: 'string', enum: [...SAVE_MODES] } } },
  body: {
    type: 'object',
    required: ['recipientName', 'address', 'appointmentAt', 'codCents', 'note'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      recipientName: { type: 'string', minLength: 1 },
      address: { type: 'string', minLength: 1 },
      appointmentAt: { type: 'string', format: 'date-time' },
      codCents: { type: 'integer', minimum: 0 },
      note: { type: 'string' },
    },
  },
} as const;

/**
 * API vận đơn. `PATCH /shipments/:id?mode=...` chọn cách lưu để so sánh trên cùng một API:
 * lww (trước), for-update và check-then-write (hai cách chưa đủ), version (Optimistic Offline Lock, mặc định).
 * Header `x-user` là người sửa (lab không có đăng nhập).
 */
export function buildApp(db: Kysely<Database>, opts: { logLevel?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logLevel ? { level: opts.logLevel } : false });

  // Lỗi miền -> HTTP: tương đương exception filter của NestJS.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ConcurrentModificationError) {
      req.log.info(
        { shipmentId: err.current.id, expectedVersion: err.expectedVersion, currentVersion: err.current.version, user: req.headers['x-user'] },
        'từ chối lưu: vận đơn đã được người khác sửa',
      );
      return reply.code(409).send({ error: 'concurrent_modification', message: err.message, current: err.current });
    }
    if (err instanceof ShipmentNotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    return reply.send(err); // lỗi validate (400) và lỗi khác giữ cách xử lý mặc định của Fastify
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Params: { id: number } }>(
    '/shipments/:id',
    { schema: { params: saveSchema.params } },
    async (req) => {
      const shipment = await getShipment(db, req.params.id);
      if (!shipment) throw new ShipmentNotFoundError(req.params.id);
      return shipment;
    },
  );

  app.patch<{ Params: { id: number }; Querystring: { mode?: SaveMode }; Body: SaveBody }>(
    '/shipments/:id',
    { schema: saveSchema },
    async (req, reply) => {
      const { version, ...form } = req.body;
      const mode = req.query.mode ?? 'version';
      const user = String(req.headers['x-user'] ?? 'anonymous');
      const id = req.params.id;
      if ((mode === 'version' || mode === 'check-then-write') && version === undefined) {
        return reply.code(400).send({ error: 'version_required', message: 'Form phải gửi kèm version đã đọc' });
      }
      switch (mode) {
        case 'lww':
          return saveShipmentLastWriteWins(db, id, form, user);
        case 'for-update':
          return saveShipmentSelectForUpdate(db, id, form, user);
        case 'check-then-write':
          return saveShipmentCheckThenWrite(db, id, version!, form, user);
        case 'version':
          return saveShipment(db, id, version!, form, user);
      }
    },
  );

  return app;
}
