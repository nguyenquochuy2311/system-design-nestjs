import type pg from 'pg';

export interface TransferInput {
  fromWalletId: number;
  toWalletId: number;
  amount: number; // đồng
  userId: string; // người thực hiện, ghi vào transfers.created_by qua biến app.user_id
}

export interface TransferResult {
  transferId: number;
  fromBalance: number;
}

export class InsufficientFundsError extends Error {
  constructor(readonly walletId: number) {
    super(`Ví ${walletId} không đủ số dư`);
  }
}

export class WalletNotFoundError extends Error {
  constructor(readonly walletId: number) {
    super(`Không có ví ${walletId}`);
  }
}

/**
 * Chuyển tiền giữa hai ví trong MỘT transaction ngắn (6 vòng gọi DB). Dùng chung cho "trước" và "sau":
 * khác biệt của bài nằm ở pool truyền vào (thẳng PostgreSQL hay qua PgBouncer), không ở nghiệp vụ.
 * Mọi thứ phải nằm trong transaction vì ở transaction mode, PgBouncer có thể đưa hai câu lệnh ngoài
 * transaction của cùng một client sang hai kết nối thật khác nhau.
 */
export async function transfer(pool: pg.Pool, input: TransferInput): Promise<TransferResult> {
  const client = await pool.connect(); // "trước": có thể lỗi 53300; "sau": có thể hết connectionTimeoutMillis
  let broken = false;
  try {
    await client.query('BEGIN');
    // Tương đương SET LOCAL: biến chỉ sống tới COMMIT/ROLLBACK, không rò sang client khác dùng chung kết nối thật.
    // Dùng set_config(..., true) vì SET không nhận tham số $1.
    await client.query("SELECT set_config('app.user_id', $1, true)", [input.userId]);

    // Khóa hai ví theo thứ tự id tăng dần, để hai chuyển khoản ngược chiều (A→B và B→A) không deadlock.
    let fromBalance = 0;
    const steps = input.fromWalletId < input.toWalletId ? (['debit', 'credit'] as const) : (['credit', 'debit'] as const);
    for (const step of steps) {
      if (step === 'debit') fromBalance = await debit(client, input.fromWalletId, input.amount);
      else await credit(client, input.toWalletId, input.amount);
    }

    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO transfers (from_wallet_id, to_wallet_id, amount) VALUES ($1, $2, $3) RETURNING id',
      [input.fromWalletId, input.toWalletId, input.amount],
    );
    await client.query('COMMIT');
    return { transferId: Number(rows[0]!.id), fromBalance };
  } catch (err) {
    // ROLLBACK lỗi nghĩa là kết nối đã hỏng: báo pool hủy kết nối này. Lỗi gốc vẫn được ném ra.
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    client.release(broken);
  }
}

async function debit(client: pg.PoolClient, walletId: number, amount: number): Promise<number> {
  const res = await client.query<{ balance: string }>(
    'UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE id = $1 AND balance >= $2 RETURNING balance',
    [walletId, amount],
  );
  if (res.rowCount === 1) return Number(res.rows[0]!.balance);
  const exists = await client.query('SELECT 1 FROM wallets WHERE id = $1', [walletId]);
  if (exists.rowCount === 0) throw new WalletNotFoundError(walletId);
  throw new InsufficientFundsError(walletId);
}

async function credit(client: pg.PoolClient, walletId: number, amount: number): Promise<void> {
  const res = await client.query('UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE id = $1', [walletId, amount]);
  if (res.rowCount !== 1) throw new WalletNotFoundError(walletId);
}
