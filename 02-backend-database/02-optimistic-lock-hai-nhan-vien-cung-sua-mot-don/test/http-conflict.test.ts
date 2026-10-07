import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/shared/db';
import { formOf, type Shipment } from '../src/shared/shipment';
import { createShipment, ensureVersionColumn } from './helpers';

const db = createDb();
const app = buildApp(db);

beforeAll(() => ensureVersionColumn(db));
afterAll(async () => {
  await app.close();
  await db.destroy();
});

async function open(id: number): Promise<Shipment> {
  const res = await app.inject({ method: 'GET', url: `/shipments/${id}` });
  expect(res.statusCode).toBe(200);
  return res.json<Shipment>();
}

function save(id: number, body: object, mode = 'version', user = 'A') {
  return app.inject({ method: 'PATCH', url: `/shipments/${id}?mode=${mode}`, headers: { 'x-user': user }, payload: body });
}

describe('hợp đồng HTTP của API vận đơn', () => {
  it('PATCH với version cũ trả 409 kèm bản hiện tại để màn hình gộp dùng', async () => {
    const { id } = await createShipment(db);
    const a = await open(id);
    const b = await open(id);
    const okA = await save(id, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3', version: a.version }, 'version', 'A');
    expect(okA.statusCode).toBe(200);
    expect(okA.json<Shipment>().version).toBe(a.version + 1);

    const resB = await save(id, { ...formOf(b), note: 'Gọi trước 15 phút', version: b.version }, 'version', 'B');
    expect(resB.statusCode).toBe(409);
    expect(resB.json()).toMatchObject({
      error: 'concurrent_modification',
      current: { id, address: '45 Hai Bà Trưng, Quận 3', version: a.version + 1, updatedBy: 'A' },
    });
  });

  it('PATCH vận đơn không tồn tại trả 404, không phải 409', async () => {
    const s = await createShipment(db);
    const res = await save(2_000_000_000, { ...formOf(s), version: 1 });
    expect(res.statusCode).toBe(404);
  });

  it('chế độ version mà form không gửi version thì trả 400', async () => {
    const s = await createShipment(db);
    const res = await save(s.id, formOf(s));
    expect(res.statusCode).toBe(400);
  });

  it('chế độ lww (trước) trả 200 cho form cũ: triệu chứng nhìn từ phía HTTP là "mọi thứ đều ổn"', async () => {
    const { id } = await createShipment(db);
    const a = await open(id);
    const b = await open(id);
    expect((await save(id, { ...formOf(a), address: '45 Hai Bà Trưng, Quận 3' }, 'lww', 'A')).statusCode).toBe(200);
    const resB = await save(id, { ...formOf(b), note: 'Gọi trước 15 phút' }, 'lww', 'B');
    expect(resB.statusCode).toBe(200);
    expect(resB.json<Shipment>().address).toBe('12 Lê Lợi, Quận 1');
  });
});
