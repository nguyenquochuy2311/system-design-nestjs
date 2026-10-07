import { sql, type Kysely } from 'kysely';
import type { Database } from '../../shared/db';

// Lớp mỏng trên các hàm SQL của PGMQ (https://github.com/pgmq/pgmq). Mỗi hàm nhận `db` hoặc `trx`:
// truyền `trx` là chạy trong transaction của người gọi, đó là lý do dùng PGMQ thay vì một broker riêng.

export interface ExportMessage {
  jobId: number;
}

export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: ExportMessage;
}

type Executor = Kysely<Database>;

export async function sendMessage(executor: Executor, queue: string, message: ExportMessage): Promise<number> {
  const { rows } = await sql<{ msg_id: number }>`SELECT pgmq.send(${queue}, ${JSON.stringify(message)}::jsonb) AS msg_id`.execute(executor);
  return rows[0]!.msg_id;
}

/** Đọc tối đa `qty` message; message được ẩn `vt` giây và `read_ct` tăng 1. Hết `vt` mà chưa xóa thì hiện lại. */
export async function readMessages(executor: Executor, queue: string, vtSeconds: number, qty: number): Promise<QueueMessage[]> {
  const { rows } = await sql<QueueMessage>`SELECT msg_id, read_ct, message FROM pgmq.read(${queue}, ${vtSeconds}::int, ${qty}::int)`.execute(executor);
  return rows;
}

/** Gia hạn: message tiếp tục ẩn thêm `vtSeconds` giây tính từ bây giờ (heartbeat của worker còn sống). */
export async function extendVisibility(executor: Executor, queue: string, msgId: number, vtSeconds: number): Promise<void> {
  await sql`SELECT msg_id FROM pgmq.set_vt(${queue}, ${msgId}::bigint, ${vtSeconds}::int)`.execute(executor);
}

export async function deleteMessage(executor: Executor, queue: string, msgId: number): Promise<void> {
  await sql`SELECT pgmq.delete(${queue}, ${msgId}::bigint)`.execute(executor);
}

/** Chuyển message sang bảng archive `pgmq.a_<queue>`: giữ lại để điều tra, không giao lại nữa. */
export async function archiveMessage(executor: Executor, queue: string, msgId: number): Promise<void> {
  await sql`SELECT pgmq.archive(${queue}, ${msgId}::bigint)`.execute(executor);
}

export async function queueLength(executor: Executor, queue: string): Promise<number> {
  const { rows } = await sql<{ queue_length: number }>`SELECT queue_length FROM pgmq.metrics(${queue})`.execute(executor);
  return Number(rows[0]?.queue_length ?? 0);
}
