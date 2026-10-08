/**
 * Ghi mỗi giây một dòng {wall, mono}: wall = Date.now(), mono = process.hrtime. Chạy nền song song với lượt đo dài để có
 * một nhật ký độc lập về các khoảng máy ngủ (hai dòng liền nhau cách nhau quá 2,5 s). Mẫu bài 04/02.
 *   pnpm tsx bench/sleep-watch.ts bench/results/main/clock.log
 */
import { appendFileSync } from 'node:fs';

const file = process.argv[2] ?? 'bench/results/main/clock.log';
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
setInterval(() => appendFileSync(file, `${JSON.stringify({ wall: Date.now(), mono: mono() })}\n`), 1_000);
