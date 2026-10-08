/**
 * Ghi mỗi giây một dòng {wall, mono}: wall = Date.now() (đồng hồ thường, chạy cả lúc máy ngủ), mono = process.hrtime
 * (trên macOS là mach_absolute_time, dừng khi máy ngủ). Hiệu (wall − mono) tăng vọt nghĩa là máy vừa ngủ. Dùng để ghi
 * lại máy ngủ bao lâu trong một lượt đo (lab chạy trên laptop gập nắp, chạy pin: macOS ngủ rồi DarkWake từng đợt).
 *   pnpm tsx bench/sleep-watch.ts bench/results/main/clock.log
 */
import { appendFileSync } from 'node:fs';

const file = process.argv[2] ?? 'bench/results/main/clock.log';
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
setInterval(() => appendFileSync(file, `${JSON.stringify({ wall: Date.now(), mono: mono() })}\n`), 1_000);
