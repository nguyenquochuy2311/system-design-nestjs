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

5. **Máy phải thức suốt lượt đo.** Laptop gập nắp hoặc chạy pin sẽ "Maintenance Sleep" từng đợt và làm mọi tiến trình đứng
   (bài 04/02 mất 3 lượt đo vì thế). Trước lượt dài: cắm sạc, mở nắp, chạy `caffeinate -ims -t <giây>`; script đo ghi
   khoảng máy ngủ (so đồng hồ tường với mốc mỗi giây, như `bench/sleep-watch.ts` của bài 04/02) và lượt có khoảng ngủ
   phải chạy lại. Kiểm nhanh: `pmset -g batt`, `ioreg -r -k AppleClamshellState -d 4 | grep AppleClamshellState`.
6. **Không xóa thư mục mà container đang bind-mount** (ví dụ `.data/`) khi container còn chạy: Nginx mất thư mục log và
   test lỗi theo kiểu khó đoán. Luôn `docker compose down -v` trước rồi mới xóa.

## 2. Cổng cố định cho lab

Tránh cổng mặc định để không đụng dự án khác. Lab chạy tuần tự và tắt sau khi đo, nên các bài dùng chung bảng này.

| Dịch vụ | Cổng host |
|---|---|
| PostgreSQL (bản chính; cần PGMQ thì `ghcr.io/pgmq/pg16-pgmq:v1.13.0`) | 55432 |
| PostgreSQL thứ hai (replica, service B...) | 55433, 55434 |
| PgBouncer (instance thứ hai) | 56432 (56433) |
| Redis | 56379 (nút thêm: 56380, 56381) |
| RabbitMQ / UI | 55672 / 55673 |
| Kafka | 59092 |
| NATS | 54222 |
| Elasticsearch / OpenSearch | 59200 |
| S3-compatible: RustFS `rustfs/rustfs:1.0.1` (thay MinIO; xem nhật ký 2026-10-07 về thao tác đã kiểm / chưa kiểm) | 59000 |
| Keycloak | 58080 |
| Prometheus / Grafana | 59090 / 53000 |
| OTel Collector (gRPC / HTTP) | 54317 / 54318 |
| Tempo / Loki | 53200 / 53100 |
| Qdrant | 56333 |
| Temporal | 57233 |
| API của lab | 3100 (service thêm: 3101, 3102...) |
| Frontend của lab | 5173 hoặc 3200 |
| Nginx (CDN mô phỏng, reverse proxy) | 58088 |
| Toxiproxy `ghcr.io/shopify/toxiproxy:2.12.0` (API điều khiển / proxy tới API của lab) | 58474 / 58401 (proxy thêm: 58402...) |
| Registry local `registry:2.8.3` (push/pull image của lab, Trivy kéo image để quét) | 58500 |

Lab cần nhiều bản sao ứng dụng (pod): chạy pod trong container cùng mạng Compose với DB (`docker compose --scale`,
code gói bằng esbuild, `node:20-alpine`), k6 trong container `grafana/k6` cùng mạng; không nối pod trên host qua cổng
đã mở ra host (proxy cổng của Docker Desktop thành nút thắt). Ghi load average và % CPU của máy ảo Docker cho từng lượt.
Mẫu: bài 02/03.

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
- Số đo thô ghi vào `bench/results/` (không commit). Lượt chính để trong một thư mục (ví dụ `bench/results/main/`);
  lượt chạy lại, kiểm tra hay thử nghiệm ghi vào thư mục khác (`recheck/`, `trial/`), **không ghi đè file thô mà
  README đã trích**. Bài 02/04 phải sửa số trong README vì file của lượt chính bị một lượt sau ghi đè.
  Ghi rõ hạn chế: seed nhỏ hơn mục 1, chạy chung máy, ít mẫu.
- Không suy diễn vượt bằng chứng: nếu không tách được nguyên nhân, viết "chưa tách riêng được".
- k6: URL có id thì đặt tag `name` cố định cho từng endpoint (ví dụ `PATCH /shipments/:id`), nếu không k6 tạo
  một chuỗi số liệu cho mỗi id, tốn RAM/CPU ngay trên máy đang chạy API và làm bẩn số đo (bài 02/02).
- So một overhead nhỏ (cỡ ≤ 1 ms): chạy nhiều vòng, xoay thứ tự, có warm-up; ghi trung vị kèm thấp nhất – cao nhất
  và chênh lệch theo từng vòng. Chênh nhỏ hơn dao động giữa các vòng thì ghi "không thấy vượt mức nhiễu".

## 5b. Ngân sách thời gian (để làm nhanh mà vẫn trung thực)

Mục tiêu khoảng **60–90 phút cho một bài** (10 bài đầu mất 1–3 giờ, phần lớn ở lượt đo dài và đo lại).

- **Đo vừa đủ:** chỉ số dạng "đúng/sai" (lost update, cache cũ, request lỗi, số câu SQL) không cần chạy lâu; một lượt
  ngắn có cỡ mẫu rõ ràng là đủ. Chỉ số độ trễ / thông lượng: 3 vòng × 30–60 s có xoay thứ tự là mặc định; chỉ tăng khi
  chênh lệch nằm sát nhiễu. Lượt "ngâm" dài (≥ 10 phút) chỉ khi chỉ số của bài thật sự phụ thuộc thời gian dài
  (rò bộ nhớ, TTL, lịch job) và ghi lý do.
- **Lượt thử trước, lượt chính sau:** lượt thử ngắn (vài chục giây) để bắt lỗi script; lượt chính chạy một lần đúng
  cấu hình. Đừng chạy lượt chính rồi mới phát hiện lỗi đếm.
- **Kiểm điều kiện máy trước lượt dài** (nguồn điện, nắp, load < khoảng 8) để không phải đo lại.
- **Chạy lại từ đầu** ở bước hoàn tất là để kiểm "Cách chạy", không phải để đo lại toàn bộ: dùng tham số ngắn nhất
  chứng minh được cùng kết luận.
- Người điều phối kiểm chứng bằng `node scripts/kiem-chung-lab.mjs <thư-mục-bài> [--seed] [--keep-up]` cộng phần
  đối chiếu số đo và một phép thử âm.

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

## 8. Kiểm chứng rồi mới commit và push (mỗi bài một commit)

Người sở hữu repo yêu cầu: **dựng code và dịch vụ dưới local, kiểm chứng, rồi mới commit và push** — từng bài một.
Người làm lab không tự commit; người điều phối (hoặc chính phiên Claude chính) làm các bước sau:

1. **Chạy lại độc lập** theo đúng "Cách chạy" trong README bài, từ volume sạch (`docker compose down -v` trước):
   dựng dịch vụ, seed, `pnpm typecheck`, `pnpm test`. Phải pass; không pass thì không commit.
2. **Đối chiếu số đo**: các số ở mục 5.1 phải khớp file thô trong `bench/results/` (hoặc output đã ghi lại);
   số nào không truy được nguồn thì sửa README hoặc đo lại.
3. **Lint**: `node scripts/kiem-tra-readme.mjs` 0 lỗi; `node scripts/tao-tien-do.mjs` sinh lại.
4. **Dọn dẹp**: `docker compose down -v`, không còn tiến trình nghe ở cổng của lab.
5. **Commit chọn lọc**: chỉ thư mục của bài và các file dùng chung liên quan (README scope, `TIEN-DO.md`,
   nhật ký); không `git add -A` khi có lab khác đang dở. Kiểm `git diff --cached --name-only` không lọt
   `node_modules/`, `bench/results/`, `.env`. Message: `feat(SS/NN): lab <pattern>, số đo thật`.
6. **Push** lên `origin main`, xác nhận `git status -sb` báo đồng bộ với `origin/main`.
