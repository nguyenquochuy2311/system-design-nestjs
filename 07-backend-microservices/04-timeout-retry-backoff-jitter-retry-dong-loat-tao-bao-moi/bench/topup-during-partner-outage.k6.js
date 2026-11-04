// Nạp tiền ở tốc độ cố định (mô hình mở) cho cả hai bản. Trạng thái từng request đọc từ --out json của k6:
// 200 là hoàn tất, 202 là "đang xử lý", còn lại là lỗi.
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL;
const RATE = Number(__ENV.RATE ?? 50);
const DURATION = __ENV.DURATION ?? '3m';

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    topup: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      // Bản "trước" không có timeout: 50 request/giây treo 20 giây cần cỡ 1.000 VU (nhật ký 08/02 điểm 3).
      preAllocatedVUs: 2000,
      maxVUs: 4000,
    },
  },
};

export default function topUp() {
  http.post(`${BASE_URL}/topups`, JSON.stringify({ amountVnd: 500000 }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'POST /topups' },
    timeout: '60s',
    responseCallback: http.expectedStatuses(200, 202),
  });
}
