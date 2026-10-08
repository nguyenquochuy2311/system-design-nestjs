import http from 'k6/http';
import { check } from 'k6';

// Đo độ trễ /login dưới tải. Tài khoản "bench" chuyên dụng dùng một mật khẩu hằng số (không bí mật),
// để không phải ghi mật khẩu tổng hợp ra file. Tag name cố định (nhật ký 02/02 điểm 1).
const BASE = __ENV.BASE || 'http://127.0.0.1:3100';
const VARIANT = __ENV.VARIANT || 'sau'; // 'truoc' (MD5) hoặc 'sau' (Argon2id)
const NUSERS = Number(__ENV.NUSERS || 200);
const PASSWORD = __ENV.PASSWORD || 'bench-user-password-2026';
const OUT = __ENV.OUT || 'summary.json';

export const options = {
  scenarios: {
    login: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || '30s',
      gracefulStop: '10s',
    },
  },
};

export default function () {
  // Rải đều trên NUSERS tài khoản để không chỉ chạm một email.
  const i = (__VU * 100000 + __ITER) % NUSERS;
  const res = http.post(
    `${BASE}/${VARIANT}/login`,
    JSON.stringify({ email: `bench${i}@lab.bench`, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: `POST /${VARIANT}/login` } },
  );
  check(res, { 'status 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const out = {};
  out[OUT] = JSON.stringify(data, null, 2);
  return out;
}
