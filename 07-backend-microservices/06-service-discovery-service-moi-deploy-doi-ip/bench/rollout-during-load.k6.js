// Tải đều RATE request/giây vào order trong lúc deploy. Đếm mã lỗi theo thời điểm bằng file CSV của k6.
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL ?? 'http://k3s:30080';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    quotes: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE ?? 20),
      timeUnit: '1s',
      duration: __ENV.DURATION ?? '60s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
};

export default function quote() {
  http.get(`${BASE_URL}/quote?km=5`, { timeout: '5s', responseCallback: http.expectedStatuses(200) });
}
