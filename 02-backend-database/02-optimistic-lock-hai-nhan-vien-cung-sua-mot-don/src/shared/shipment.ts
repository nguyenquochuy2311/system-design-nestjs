import type { Kysely, Selectable } from 'kysely';
import type { Database } from './db';

/** Vận đơn như API trả về. `appointmentAt` là chuỗi ISO để đi qua JSON không đổi giá trị. */
export interface Shipment {
  id: number;
  trackingCode: string;
  recipientName: string;
  address: string;
  appointmentAt: string;
  codCents: number;
  note: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

/** Các trường nhân viên sửa trên form "Chi tiết vận đơn". Form luôn gửi lại TẤT CẢ các trường này. */
export interface ShipmentForm {
  recipientName: string;
  address: string;
  appointmentAt: string;
  codCents: number;
  note: string;
}

export const FORM_FIELDS = ['recipientName', 'address', 'appointmentAt', 'codCents', 'note'] as const;

export function toShipment(row: Selectable<Database['shipments']>): Shipment {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    recipientName: row.recipient_name,
    address: row.address,
    appointmentAt: row.appointment_at.toISOString(),
    codCents: row.cod_cents,
    note: row.note,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function formOf(s: Shipment): ShipmentForm {
  return {
    recipientName: s.recipientName,
    address: s.address,
    appointmentAt: s.appointmentAt,
    codCents: s.codCents,
    note: s.note,
  };
}

/** Cột được ghi khi lưu form: toàn bộ trường của form, kể cả trường người dùng không đụng tới. */
export function formColumns(form: ShipmentForm, updatedBy: string) {
  return {
    recipient_name: form.recipientName,
    address: form.address,
    appointment_at: form.appointmentAt,
    cod_cents: form.codCents,
    note: form.note,
    updated_by: updatedBy,
  };
}

export async function getShipment(db: Kysely<Database>, id: number): Promise<Shipment | undefined> {
  const row = await db.selectFrom('shipments').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toShipment(row) : undefined;
}

export class ShipmentNotFoundError extends Error {
  constructor(readonly shipmentId: number) {
    super(`Không tìm thấy vận đơn ${shipmentId}`);
    this.name = 'ShipmentNotFoundError';
  }
}

/**
 * Lỗi miền khi lưu từ một version đã cũ. Mang theo bản hiện tại để API trả 409 kèm dữ liệu,
 * giúp người dùng gộp lại thay vì phải tải lại form từ đầu.
 */
export class ConcurrentModificationError extends Error {
  constructor(
    readonly current: Shipment,
    readonly expectedVersion: number,
  ) {
    super(`Vận đơn ${current.id} đã được ${current.updatedBy} sửa (version ${current.version}, form đang giữ version ${expectedVersion})`);
    this.name = 'ConcurrentModificationError';
  }
}
