// Công tắc CHỈ dành cho phép thử âm (bench/negative-drills.ts): gỡ từng mảnh của pattern mà không sửa mã nguồn.
// Ví dụ LAB_DRILL=no-nested-redact,no-queue-context. Giá trị rỗng (mặc định) = pattern đầy đủ.
export function drill(name: 'no-nested-redact' | 'no-queue-context' | 'console-log-ledger' | 'no-err-scrub'): boolean {
  return (process.env.LAB_DRILL ?? '').split(',').map((s) => s.trim()).includes(name);
}
