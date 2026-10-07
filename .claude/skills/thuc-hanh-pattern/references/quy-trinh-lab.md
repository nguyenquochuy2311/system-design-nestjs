# Quy trình thực hành một bài (lab)

Rút ra từ bài đầu tiên chạy thật: `02-backend-database/01-n-plus-1-trang-50-don-ban-151-cau-sql`.
Đọc code và README (mục 5.1, mục 8, "Bài học sau khi làm") của bài đó trước khi làm bài mới — nó là
mẫu chuẩn về cấu trúc, cách đo và cách viết kết quả trung thực.

Thứ tự làm các bài: `docs/thu-tu-thuc-hanh.md`. Mỗi lần chỉ chạy **một** lab, vì mọi lab đều đo hiệu năng
trên cùng một máy; chạy song song làm số đo vô nghĩa.

## 1. Trước khi code

1. Đọc README bài (đặc biệt mục 4, 5, 8), README scope, `docs/nhat-ky-quyet-dinh.md`, `references/quy-uoc-code.md`.
2. Đổi trạng thái trong bảng metadata sang `🔨 Đang làm` và cập nhật ngày.
3. Kiểm tra dịch vụ cần dùng:
   - Image kéo được: `docker manifest inspect <image>` (lỗi mạng tạm thời hay gặp — thử lại 1–2 lần trước khi kết luận).
   - Cổng trống: `lsof -nP -iTCP:<cổng> -sTCP:LISTEN`. Máy có container của dự án khác giữ 3306, 5672, 15672, 33306.
   - Công cụ trên host chưa có (k3d, helm, kustomize, trivy, hadolint...) thì **cài ngay lúc đó** bằng Homebrew,
     ghi lệnh cài vào mục 8 của README bài và một dòng vào nhật ký quyết định.
4. Dịch vụ không dùng được (image không còn, cần GPU NVIDIA...) thì **không giả lập kết quả**: chọn thay thế
   đã kiểm chứng (ghi lý do ở mục 4 và nhật ký), hoặc dừng ở 🔨 và ghi rõ phần bị chặn.

## 2. Cổng cố định cho lab

Tránh cổng mặc định để không đụng dự án khác. Lab chạy tuần tự và tắt sau khi đo, nên các bài dùng chung bảng này.

| Dịch vụ | Cổng host |
|---|---|
| PostgreSQL (bản chính) | 55432 |
| PostgreSQL thứ hai (replica, service B...) | 55433, 55434 |
| PgBouncer | 56432 |
| Redis | 56379 (nút thêm: 56380, 56381) |
| RabbitMQ / UI | 55672 / 55673 |
| Kafka | 59092 |
| NATS | 54222 |
| Elasticsearch / OpenSearch | 59200 |
| S3-compatible (thay MinIO) | 59000 |
| Keycloak | 58080 |
| Prometheus / Grafana | 59090 / 53000 |
| OTel Collector (gRPC / HTTP) | 54317 / 54318 |
| Tempo / Loki | 53200 / 53100 |
| Qdrant | 56333 |
| Temporal | 57233 |
| API của lab | 3100 (service thêm: 3101, 3102...) |
| Frontend của lab | 5173 hoặc 3200 |

## 3. Cấu trúc project (theo bài mẫu)

Mỗi bài là một project pnpm độc lập trong thư mục bài: `package.json` (scripts `db:up`, `db:seed`, `dev`,
`test`, `typecheck`...), `pnpm-lock.yaml`, `tsconfig.json` (strict), `vitest.config.ts`, `.gitignore`
(`node_modules/`, `bench/results/`, `.env`), `.env.example`, `docker-compose.yml` có healthcheck.
`src/truoc/` tái hiện triệu chứng, `src/sau/` áp dụng pattern, `src/shared/` phần chung; dòng cốt lõi của
pattern đánh dấu `// [PATTERN]`. Tên file tiếng Anh kebab-case, comment tiếng Việt.

## 4. Test

- Test đặt tên theo hành vi bằng tiếng Việt; chứng minh hành vi cốt lõi của pattern, thường là cặp
  "trước tái hiện lỗi / sau hết lỗi".
- **Phép thử âm**: gỡ pattern (hoặc dựng lại điều kiện lỗi) và xác nhận test/chỉ số thật sự đổi.
  Test chỉ đạt khi có pattern mới đáng tin.
- Test không giả định dữ liệu "trang đầu" hay thứ tự phụ thuộc thời gian khi có ghi song song.

## 5. Đo

- Đo đúng các chỉ số ở mục 5 của README; giữ nguyên bảng "Trước (minh họa)".
- Ghi mục `### 5.1 Số đã đo`: môi trường (máy, Docker CPU/RAM, phiên bản dịch vụ, Node, k6), quy mô dữ liệu,
  tải (VUs, thời gian), bảng kết quả, và đối chiếu với từng mục tiêu ("đạt", "không đạt", "chưa đo").
- Số đo thô ghi vào `bench/results/` (không commit). Ghi rõ hạn chế: seed nhỏ hơn mục 1, chạy chung máy, ít mẫu.
- Không suy diễn vượt bằng chứng: nếu không tách được nguyên nhân, viết "chưa tách riêng được".

## 6. Hoàn tất

1. Chạy lại **từ đầu** theo phần "Cách chạy" trong README (volume sạch: `docker compose down -v`) để chắc hướng dẫn đúng.
2. Cập nhật README: mục 4 (ghi chú lệch stack), 3.4 (điểm dễ sai gặp thật), mục 8 (tick checklist, cấu trúc
   thật, cách chạy thật), thêm `## Bài học sau khi làm` (gồm cả lỗi đã gặp và hạn chế số đo).
3. Trạng thái `✅ Hoàn thành` chỉ khi: chạy được từ hướng dẫn, test pass, có số đo thật. Thiếu một điều kiện → giữ `🔨`.
4. Cập nhật cột trạng thái của bài trong bảng ở README scope.
5. `node scripts/kiem-tra-readme.mjs` (0 lỗi) và `node scripts/tao-tien-do.mjs`.
6. Dọn dẹp: `docker compose down -v`, tắt mọi tiến trình nền đã mở (kiểm lại cổng). Không để server chạy sót.
7. Quyết định có tính "từ nay về sau" → `docs/nhat-ky-quyet-dinh.md`.

## 7. Không làm

- Không sửa bài khác, skill hay script nếu không được giao; không commit hay push.
- Không đổi số "trước (minh họa)" thành số đo; không ghi số chưa đo.
- Không cài phần mềm hệ thống ngoài công cụ dev mà bài cần (Homebrew formula, package npm trong project).
