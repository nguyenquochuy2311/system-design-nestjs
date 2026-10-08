import { reloadNginx } from '../../scripts/cdn';
import { assertCdnUp } from './lab';

// Một lần cho cả lượt test: CDN phải đang chạy, và hai Nginx nạp lại cấu hình từ nginx/*.conf (phép thử âm sửa các
// file này; reload để test luôn chạy trên cấu hình hiện tại của mã nguồn).
export default async function setup(): Promise<void> {
  await assertCdnUp();
  await reloadNginx('origin');
  await reloadNginx('cdn');
}
