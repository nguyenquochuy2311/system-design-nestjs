# Nhật ký quyết định

Bộ nhớ dài hạn của repo. Mỗi quyết định "từ nay về sau" ghi một mục: ngày · quyết định · lý do ·
ảnh hưởng. Phiên làm việc sau đọc file này trước để không mở lại điều đã chốt. Muốn đảo một quyết
định: thêm mục mới dẫn tới mục cũ, không xóa mục cũ.

## 2026-10-06 — Khởi tạo repo và chốt khung

**Quyết định**
1. 24 scope theo đúng danh sách đề bài; slug thư mục tiếng Anh không dấu, số thứ tự `01`–`24`.
2. Tên bài toán = `<Pattern tiếng Anh> — <Triệu chứng bằng lời người kinh doanh>`; thư mục
   `NN-<pattern-slug>-<trieu-chung-slug>`.
3. README bài toán có đúng 8 mục (What / Why / How / Tech stack / Impact / Đánh đổi / Nguồn / Kế hoạch),
   lint bằng `scripts/kiem-tra-readme.mjs`.
4. Mọi pattern phải truy được về nguồn trong danh mục chuẩn của skill; nguồn chưa chắc ghi `(cần xác minh)`.
5. Số liệu trong bối cảnh gắn nhãn "minh họa"; kết quả chỉ ghi khi "đã đo" kèm môi trường.
6. Bối cảnh là doanh nghiệp giả định theo lĩnh vực; không dùng tên công ty thật làm bối cảnh.
7. Sơ đồ bằng Mermaid; tối thiểu một flowchart và một sequenceDiagram mỗi bài.
8. Stack mặc định: TypeScript strict, Node 20+, NestJS/Fastify, Next.js, PostgreSQL 16, Redis 7,
   Docker Compose, Vitest, k6, Anthropic SDK (model mặc định `claude-opus-5-5`).
9. `TIEN-DO.md` chỉ sinh bằng script, không sửa tay.
10. Skill `thuc-hanh-pattern` đặt trong repo (`.claude/skills/`) để mọi phiên Claude Code đọc chung.

**Lý do**
- Người sở hữu repo đang làm NestJS + Kysely + PostgreSQL + PGMQ + Turborepo và Next.js; stack trùng
  giúp bài học chuyển thẳng vào công việc.
- Đặt tên theo triệu chứng giúp người kinh doanh và kỹ sư cùng nhận ra bài toán; giữ tên pattern
  tiếng Anh để tra được tài liệu gốc.
- Yêu cầu "không bịa đặt" là ràng buộc gốc của repo, nên danh mục nguồn và nhãn số liệu được đưa vào
  template và lint thay vì chỉ dặn dò.

**Ảnh hưởng**
- Thêm scope mới hoặc đổi template là quyết định phải ghi ở đây trước khi làm.
- Agent/phiên viết README bài toán chỉ được dùng pattern và nguồn đã liệt kê trong README scope hoặc
  danh mục nguồn.

## 2026-10-06 — Rate limiting đặt ở scope 13, không ở scope 03

**Quyết định:** Bài "Rate Limiting & Throttling" nằm trong `13-backend-transporter`; scope `03-backend-cache`
chỉ liên kết tới.
**Lý do:** Vấn đề kinh doanh (một khách API làm chậm khách khác) là vấn đề ở biên API; Redis chỉ là nơi
lưu bộ đếm.
**Ảnh hưởng:** Bài ở scope 03 về hot key / distributed lock dẫn chéo sang bài này khi cần bộ đếm phân tán.

## 2026-10-06 — Model Routing/Cascade đặt ở scope 22, scope 20 chỉ liên kết

**Quyết định:** Bài routing theo chi phí (FrugalGPT, RouteLLM) nằm trong `22-backend-ai-optimizer`.
**Lý do:** Mục tiêu chính của bài là chi phí; scope 20 tập trung vào cấu trúc framework.
**Ảnh hưởng:** Scope 20 có bài "Model Gateway" (trừu tượng hóa provider) làm nền cho routing ở scope 22.

## 2026-10-06 — Ngoại lệ về ngôn ngữ và tên file trong code thực hành

**Quyết định**
1. Bài cần thống kê, huấn luyện hoặc lượng tử hóa (ví dụ 22/08, 22/09, 24/08) được phép dùng Python thay cho TypeScript; lý do ghi ở mục 4 của bài.
2. Tên file Python dùng `snake_case` khi file được import hoặc pytest tự tìm (ví dụ `drift_tests.py`); file chạy như script đơn lẻ giữ kebab-case.
3. Bài 21/05: Anthropic không có API embedding, bước embed dùng Text Embeddings Inference; Message Batches chỉ dùng cho bước sinh ngữ cảnh chunk.
4. Bài 04/02 dùng Vite SPA thay cho Next.js, vì Next.js đã tự băm tên file tĩnh nên không tái hiện được triệu chứng cache cũ.

**Lý do:** Ghi lại lệch khỏi stack mặc định để phiên sau không "sửa cho đồng nhất" nhầm.
**Ảnh hưởng:** Quy ước trong `references/quy-uoc-code.md` giữ nguyên; các ngoại lệ trên đứng cạnh nó.

## 2026-10-06 — Đính chính nguồn: DDIA ch.3 không bàn write-back

**Quyết định:** Bài 03/04 trích DDIA ch.7 (durability) và ch.5 (read-your-writes), không trích ch.3 (Storage and Retrieval).
**Lý do:** ch.3 nói về cấu trúc lưu trữ, không bàn cache write-back; nguồn trong bảng scope ban đầu ghi sai chương.

## 2026-10-06 — Quy ước cho code thực hành (rút ra từ bài đầu tiên 02/01)

**Quyết định**
1. Mỗi bài thực hành là một project pnpm độc lập nằm ngay trong thư mục bài (có `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`); repo gốc không dùng workspace.
2. Cổng hạ tầng của lab không dùng cổng mặc định (Postgres `55432`, không `5432`) để không đụng container của dự án khác trên máy; ghi cổng trong `docker-compose.yml` và `.env.example`.
3. Số đo thô của k6 ghi vào `bench/results/` và KHÔNG commit (`.gitignore` của bài); chỉ số đã chọn lọc, kèm môi trường đo, ghi vào mục 5.1 của README bài.
4. Lab nhỏ dùng Fastify thay NestJS khi chỉ cần vài route; ghi lý do ở mục 4 của README bài.
5. Seed nhỏ hơn quy mô trong mục 1 (laptop) là chấp nhận được nếu ghi rõ tỉ lệ và các hạn chế ở mục 5.1.
6. Test tích hợp không giả định nội dung "trang đầu" khi có ghi song song; nhắm bản ghi cụ thể.

**Lý do:** Bài 02/01 là bài đầu tiên chạy thật; các quy ước trên tránh va chạm cổng, giữ repo gọn và giữ số đo trung thực.
**Ảnh hưởng:** Bài thực hành sau theo cùng khung; `references/quy-uoc-code.md` giữ nguyên, các điểm trên bổ sung cho nó.

## 2026-10-07 — Quy ước đo rút ra từ bài 02/02 (Optimistic Offline Lock)

**Quyết định**
1. Script k6 gọi URL có id phải đặt tag `name` cố định cho từng endpoint (ví dụ `PATCH /shipments/:id`). Không đặt thì k6 tạo một chuỗi số liệu cho mỗi id (bài 02/02 vượt 100.000 chuỗi), tốn RAM/CPU ngay trên máy đang chạy API và làm bẩn số đo.
2. Khi so một overhead nhỏ (cỡ ≤ 1 ms) giữa hai cách làm: chạy nhiều vòng (bài 02/02 dùng 5), xoay thứ tự giữa các vòng, ghi trung vị kèm thấp nhất – cao nhất và chênh lệch theo từng vòng. Chênh lệch nhỏ hơn dao động giữa các vòng thì ghi "không thấy vượt mức nhiễu", không ghi như một con số chính xác.
3. Ngoại lệ của bài 02/02: không dựng frontend Next.js; màn hình gộp được thay bằng hàm gộp ba phía `mergeShipmentForm` có test, vì chỉ số của bài nằm ở phía API/DB.

**Lý do:** Lượt đo k6 đầu của bài 02/02 phải bỏ vì lỗi (1); chênh p95 giữa `UPDATE ... WHERE id` và `UPDATE ... WHERE id AND version` nhỏ hơn dao động giữa các vòng (2).
**Ảnh hưởng:** Script k6 của các bài sau theo (1); mục 5.1 của bài có chỉ số overhead theo (2); phiên sau không "bổ sung" frontend cho bài 02/02 trừ khi được yêu cầu.

## 2026-10-07 — Quy ước lab nhiều pod rút ra từ bài 02/03 (Connection Pooling)

**Quyết định**
1. Lab cần nhiều bản sao ứng dụng (pod) chạy chúng trong container cùng mạng Compose với DB: service nhân bản bằng `docker compose --scale`, code gói thành một file JS bằng esbuild, image `node:20-alpine`. Không chạy pod là tiến trình Node trên host rồi nối vào cổng đã mở ra host. k6 chạy trong container `grafana/k6` cùng mạng khi tải phải chia cho nhiều bản sao (DNS của Docker trả IP mọi bản sao, k6 `dns.select = roundRobin`).
2. Instance thứ hai của PgBouncer dùng cổng host 56433 (bảng cổng trong `quy-trinh-lab.md` mới có 56432).
3. Lượt đo nhiều bản sao ghi kèm load average và % CPU bận của máy ảo Docker (đọc `/proc/loadavg`, `/proc/stat` trong một container) để biết mức tranh CPU giữa pod, k6 và DB.

**Lý do:** Đo thử ở bài 02/03, pod trên host gọi DB qua proxy cổng của Docker Desktop: `com.docker.backend` khoảng 124 % CPU, 22–29/30 kết nối PostgreSQL ở `ClientRead`, thông lượng chỉ khoảng 1/3 so với pod trong mạng Compose; số đo phản ánh proxy chứ không phải pattern. Ở 40 pod trên laptop 8 vCPU, load của máy ảo lên 15–45, nên số độ trễ cần đọc cùng mức tranh CPU.
**Ảnh hưởng:** Bài cần nhiều bản sao (scope 16, 18...) theo (1) và (3). Bảng cổng trong skill chưa sửa (phiên này không được sửa skill); người sở hữu skill quyết định có bổ sung 56433 hay không.

## 2026-10-07 — Quy ước lab rút ra từ bài 02/04 (Audit Log & Soft Delete)

**Quyết định**
1. Healthcheck của container PostgreSQL hỏi qua TCP: `pg_isready -h 127.0.0.1 ...`. Lúc chạy script trong `docker-entrypoint-initdb.d`, server tạm của image `postgres` chỉ nghe Unix socket (`listen_addresses=''`), nên hỏi qua socket có thể báo "healthy" trước khi `init.sql` xong, và `pnpm db:up && pnpm db:seed` sẽ chạy đua với init.
2. Lab có bảng từ vài trăm nghìn dòng trở lên với nhiều index (VACUUM, tạo index hay truy vấn song song) đặt `shm_size: 256mb` cho container PostgreSQL. `/dev/shm` mặc định 64 MB không đủ cho `maintenance_work_mem` 64 MB.
3. Khi pattern nằm trong database (trigger, quyền, ràng buộc) và code "trước" không tránh được nó trên cùng bảng, dựng "trước" và "sau" ở hai schema của cùng database, nạp từ một file DDL chung (bài 02/04: `truoc` và `public`). Migration của pattern chỉ áp dụng lên schema "sau".
4. So overhead của một pattern ở tầng DB qua API chạy trên host thì đo kèm thời gian một vòng gọi DB (`SELECT 1`, tuần tự và song song bằng số VU). Thêm transaction hay câu lệnh là thêm vòng gọi, và qua cổng Docker Desktop mỗi vòng cỡ 0,2 – 0,5 ms; không có số này thì dễ đổ hết độ chênh cho pattern.

**Lý do:** Bài 02/04 gặp lỗi `could not resize shared memory segment` khi `VACUUM` nhật ký 400.000 dòng (2). Ở (4), trigger chỉ tốn khoảng 0,1 ms trong DB, nhưng `withActor` thêm ba vòng gọi làm p50 qua API tăng khoảng 1,9 ms. Với (1), lab chưa gặp lỗi thật, nhưng đã thấy `listen_addresses=''` trong entrypoint của image.
**Ảnh hưởng:** Bài sau có PostgreSQL theo (1); bài có bảng lớn theo (2). `docker-compose.yml` của bài 02/01–02/03 chưa sửa (phiên này không được sửa bài khác).

## 2026-10-07 — Quy ước lab rút ra từ bài 08/01 (Layered Architecture)

**Quyết định**
1. Lab dùng NestJS ghi `@Inject(<token hoặc lớp>)` tường minh cho mọi tham số constructor. `tsx` (esbuild) không phát metadata `design:paramtypes`, còn Vitest 5 (oxc) thì có, nên DI dựa vào kiểu tham số chạy đúng trong test nhưng không tiêm được khi chạy `pnpm dev`.
2. Lab cần ESLint cho TypeScript dùng TypeScript 5.9.x thay vì 7, vì `typescript-eslint` 8.71 chỉ nhận TypeScript `<6.1`. Lab dùng dependency-cruiser trên Node 20 chọn bản 17.x, vì bản 18 đòi Node ≥ 22. Ghi lệch này ở mục 4 của bài.
3. Cổng CI bằng dependency-cruiser dùng reporter mặc định (`err`, thoát mã bằng số lỗi). `--output-type json` thoát mã 0 dù có vi phạm, chỉ dùng để lấy số liệu. Luật cấm thư viện viết theo đoạn `(^|/)node_modules/<gói>/` vì dưới pnpm đường dẫn đã phân giải nằm trong `node_modules/.pnpm/...`.
4. Bài về cấu trúc code đo "số chỗ phải sửa khi đổi một quy tắc" và phép thử âm bằng script sửa mã nguồn tạm thời (mỗi chuỗi cần sửa phải xuất hiện đúng một lần), chạy test hoặc công cụ, rồi khôi phục và so lại nội dung file (mẫu: `bench/mutation-drills.ts` của bài 08/01), không đếm bằng tay.
5. Phần trăm độ phủ ghi trong README tính từ phân số trong `coverage-summary.json`; báo cáo dạng text của Vitest coverage cắt bớt chữ số (135/146 hiện 92,46 thay vì 92,47).

**Lý do:** (1) đã kiểm bằng `Reflect.getMetadata` dưới cả hai công cụ trong bài 08/01; (2) phiên bản kiểm từ `peerDependencies` và `engines` trên registry; (3) và (5) gặp thật khi đo bài 08/01; (4) cho số đo lặp lại được và không để sót thay đổi trong mã nguồn.
**Ảnh hưởng:** Các bài còn lại của scope 08 và scope 09 (ranh giới module) theo (1)–(4). Các bài đã xong của scope 02 không đổi.

## 2026-10-07 — Dịch vụ S3-compatible thay MinIO cho các lab (rút ra từ bài 08/02)

**Quyết định**
1. Lab cần object storage dùng RustFS, ghim tag `rustfs/rustfs:1.0.1`: một container, cổng host 59000 (bảng cổng của skill), khóa qua `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`, volume `/data`, healthcheck `curl -fsS http://127.0.0.1:9000/health`. Client `@aws-sdk/client-s3` đặt `forcePathStyle: true`, vì RustFS chỉ nhận virtual-hosted-style khi cấu hình `RUSTFS_SERVER_DOMAINS`. Mẫu: `docker-compose.yml` và `src/shared/object-storage.ts` của bài 08/02.
2. Bài cần một thao tác S3 nằm ngoài danh sách "đã kiểm" dưới đây thì phải kiểm thao tác đó trên RustFS bằng script chạy thật trước khi dựa vào nó (mẫu `bench/s3-compat-check.ts` của bài 08/02), rồi ghi kết quả vào mục 4 của bài. Không giả định RustFS giống AWS S3 hay MinIO ở thao tác chưa kiểm. Thao tác không đạt thì ghi lại và chọn thay thế bằng một mục mới trong nhật ký.
3. Lab cần PGMQ dùng image `ghcr.io/pgmq/pg16-pgmq:v1.13.0` của dự án PGMQ: PostgreSQL 16.15 dựng trên `postgres:16`, PGMQ 1.13.0, có arm64. Ghim tag, không dùng `latest`. Cách cài SQL-only lên `postgres:16` chưa thử.

**Đã kiểm** (2026-10-07, RustFS 1.0.1, AWS SDK v3 3.1147.0 với cấu hình checksum mặc định, 13/13 đạt, `bench/results/main/s3-compat.json` của bài 08/02):
- CreateBucket / HeadBucket idempotent; PutObject.
- Upload stream qua `@aws-sdk/lib-storage`: 1 MiB (một part) và 12 MiB (multipart 3 part, ETag hậu tố `-3`); ghi đè cùng khóa.
- Presigned GET tải bằng curl, khớp sha256; `ResponseContentDisposition` được trả về.
- Presigned GET với TTL 5 s: còn hạn ở giây thứ 3, hết hạn ở giây thứ 7 (403 `AccessDenied`, "Request has expired").
- Chữ ký bị sửa và ký bằng secret sai đều trả 403 `SignatureDoesNotMatch`.
- Presigned PUT bằng curl; GET sau `DeleteObject` trả 404 `NoSuchKey`.

**Chưa kiểm:**
- Lifecycle (hết hạn object, hủy multipart dở), Versioning, Object Lock / retention, CORS, SSE / KMS, presigned POST (form upload).
- Multipart gọi tay (`CreateMultipartUpload` / `UploadPart` / `ListParts` / `AbortMultipartUpload`, cần cho upload tiếp tục), vì lab chỉ đi qua `lib-storage`.
- Virtual-hosted-style, IAM user / policy ngoài khóa root, nhiều node / erasure coding, client `mc` hay `aws` CLI.

**Lý do:** `minio/minio` trên Docker Hub trả "denied", `quay.io/minio/minio` không còn tag nào (người điều phối kiểm ngày 2026-10-06). Trong các image kéo được, RustFS chạy một container với hai biến môi trường giống cách cấu hình MinIO, và đạt mọi thao tác bài 08/02 cần. Các image còn lại (`localstack/localstack`, `chrislusf/seaweedfs`, `dxflrs/garage`, `ghcr.io/versity/versitygw`, `adobe/s3mock`) không thử trong phiên này, nên chưa có so sánh giữa chúng.
**Ảnh hưởng:** scope 15 (presigned upload, multipart / resumable, lifecycle...) và các bài khác cần object storage dùng RustFS; bài cần thao tác trong danh sách "chưa kiểm" phải kiểm theo (2) trước. Chỗ nhắc MinIO trong README các bài chưa làm không sửa (phiên này không được sửa bài khác); khi làm bài nào thì ghi lệch ở mục 4 của bài đó. AWS SDK v3 cảnh báo các bản phát hành sau tuần đầu tháng 1/2027 sẽ đòi Node ≥ 22: lab trên Node 20 ghim phiên bản SDK.

## 2026-10-07 — Quy ước đo rút ra từ bài 08/02 (Background Jobs)

**Quyết định**
1. Đo hay test hiện tượng event loop bị chặn thì tiến trình bị đo (web) phải chạy riêng với client đo; RSS lấy từ bên ngoài bằng `ps`. Không dựng app trong cùng tiến trình với Vitest cho phép đo này.
2. Khi báo event loop delay từ `perf_hooks.monitorEventLoopDelay`, ghi cả giá trị lớn nhất bên cạnh p99, và ghi rằng giá trị thô gồm chu kỳ lấy mẫu (resolution). Một lần bị chặn nhiều giây chỉ là một mẫu, nên p99 có thể thấp trong lúc server treo.
3. Kịch bản k6 mô hình mở (`constant-arrival-rate`) mà server có thể treo nhiều giây thì đặt `preAllocatedVUs` đủ cho số request dồn lại (tốc độ × thời gian treo), và kiểm `dropped_iterations` = 0 trước khi dùng số. Độ trễ tính trên request thành công; request lỗi đếm riêng theo `error_code`.
4. Thời điểm của mẫu `http_req_duration` trong `--out json` của k6 là lúc request kết thúc. Lọc request theo cửa sổ thời gian thì lấy lúc bắt đầu = `time − value` (đã kiểm bằng server chờ 2 giây).

**Lý do:** (1) ở bài 08/02, test dựng web chung tiến trình lúc bắt được lúc không bắt được lúc treo (một lần chỉ thấy 75 ms). (2) bản "trước" có p99 86 – 136 ms nhưng lớn nhất 1,7 – 4,4 s. (3) với 50 VU cấp sẵn, k6 bỏ 134 lượt đúng lúc server treo; với 400 VU thì 0. (4) kiểm thử trực tiếp.
**Ảnh hưởng:** các bài về hàng đợi, giám sát và tải (scope 13, 14, 18, 23) theo các điểm trên khi đo độ trễ dưới tải có lúc treo.

## 2026-10-07 — Quy ước lab rút ra từ bài 03/01 (Cache-Aside)

**Quyết định**
1. Lab dùng Redis làm cache chạy `redis:7` với cấu hình tường minh: `--save "" --appendonly no --maxmemory <n> --maxmemory-policy allkeys-lru` (bài 03/01: 1 GB). Image chạy không file cấu hình có `save 3600 1 300 100 60 10000`, `maxmemory 0`, `maxmemory-policy noeviction` (đã kiểm bằng `CONFIG GET`): đầy bộ nhớ thì `SET` báo lỗi thay vì evict, và lần khởi động lại có thể nạp bản cache cũ từ RDB. Bài cần Redis giữ dữ liệu (lock, bộ đếm, write-behind) thì ghi cấu hình riêng ở mục 4 của bài.
2. Client Redis cho cache trong lab: `ioredis` ghim phiên bản (bài 03/01: 6.0.0), đặt `commandTimeout` (bài 03/01: 50 ms), `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `retryStrategy` có trần ngắn, và luôn gắn listener `error`. Với cấu hình mặc định, request treo quá 2 giây khi Redis không kết nối được và chờ hết thời gian Redis treo (phép thử âm của bài 03/01).
3. `commandTimeout` của ioredis đếm thời gian trong tiến trình Node: event loop khựng lâu hơn timeout thì lệnh tới Redis đang khỏe vẫn có thể báo hết giờ (bài 03/01: chặn ≥ 60 ms thì 10/20 lần). Lab đo cache ghi riêng số lượt bỏ qua cache vì lỗi hay timeout (counter, header) bên cạnh hit ratio, không gộp vào "miss".
4. CPU container đo bằng hiệu `usage_usec` trong `/sys/fs/cgroup/cpu.stat` (đọc qua `docker compose exec`) giữa các lần lấy mẫu, 100 % = một nhân. Container khởi động lại thì bộ đếm về 0: bỏ khoảng có hiệu âm. Mỗi mẫu ghi kèm load 1 phút của macOS; lượt trùng lúc load host tăng vọt hoặc có `dropped_iterations` > 0 thì chạy lại dưới tên khác và giữ file cũ, README ghi cả hai.
5. Script phép thử âm phải kiểm tổng số test của lượt "đã gỡ pattern" lớn hơn 0: sửa mã nguồn thành cú pháp sai làm Vitest báo 0 test, trông như "không test nào đỏ".

**Lý do:** (1) và (2) kiểm trực tiếp trong bài 03/01. (3) lượt đo dưới tải có lượt `BYPASS` dù Redis vẫn khỏe (2 trên 100.001 request ở lượt 10 phút, 321 trong vài giây ở một lần máy khựng), và script `bench/event-loop-stall.ts` tái hiện được. (4) bộ đếm cgroup của Redis về 0 sau `docker compose start` làm CPU tính bằng hiệu đầu – cuối ra số âm; hai lượt đo của bài trùng lúc load macOS lên 16 – 19. (5) gặp thật khi viết phép thử âm "ioredis mặc định".
**Ảnh hưởng:** các bài còn lại của scope 03 và các bài dùng Redis ở scope 13, 22 theo (1)–(3); mọi lab báo CPU container theo (4); mọi lab có phép thử âm theo (5). Bài đã xong không sửa lại.

## 2026-10-07 — Quy ước đo rút ra từ bài 03/02 (Cache Invalidation)

**Quyết định**
1. Đo độ cũ của cache bằng poll thì chỉ coi trang "đã mới" khi câu trả lời mang giá trị mới **và** đến từ cache (`HIT`/`MISS`), không tính câu trả lời bỏ qua cache (`BYPASS`: Redis lỗi hay quá timeout nên đọc thẳng DB). Mốc của mỗi lần đổi là lúc lệnh ghi trả về; với job theo lịch là giờ trong lịch.
2. Bên cạnh poll, API ghi nhật ký câu trả lời có chứa bản ghi đang theo dõi (chỉ bật khi đo, `WATCH_IDS` + `WATCH_LOG`) để đếm request của tải thật nhận giá trị cũ và phát hiện trang "mới rồi lại cũ". Mẫu: `src/shared/watch-log.ts` và phần tổng hợp trong `bench/run-scenario.ts` của bài 03/02.
3. So hit ratio giữa hai bản: k6 chọn URL bằng hàm băm của `exec.scenario.iterationInTest` thay vì `Math.random` (hai bản nhận cùng một chuỗi request); request của script đo gắn header riêng (`X-Client: probe`) và counter có nhãn `client`; lượt dùng để so hit ratio tắt poll, vì lượt poll ngay sau mỗi lần xóa key thường là request trượt đầu tiên và "nhận hộ" phần trượt thêm.
4. Tái hiện "đọc chen giữa" (một lượt đọc lấy dữ liệu cũ từ DB rồi ghi vào cache sau lần xóa) bằng proxy TCP giữ kết quả PostgreSQL trả cho app (`test/support/db-proxy.ts` của bài 03/02), không chèn móc test vào mã nguồn.
5. Khoảng TTL có jitter tính bằng số nguyên (`Math.ceil(900 * (1 + 10 / 100))` là 991 trong số thực).

**Lý do:** (1) lượt đo đầu của bài 03/02 trùng lúc load macOS lên 25: Redis quá 50 ms ở 343 lượt, script poll dừng sớm và nhật ký API ghi 8.525 câu trả lời giá cũ sau đó. (3) ở lượt có poll, bản có invalidation có ít lần trượt của k6 hơn bản không có (8.174 so với 8.194); 3 vòng không poll cho chênh 77 – 82 lần trượt, ổn định giữa các vòng. (4) và (5) gặp khi viết test của bài.
**Ảnh hưởng:** các bài còn lại của scope 03 (stampede, write-through, hot key) và scope 04 (cache phía client) đo độ cũ hay hit ratio theo (1)–(3); test về thứ tự đọc/ghi giữa DB và cache dùng cách (4).

## 2026-10-07 — Quy ước lab rút ra từ bài 04/01 (HTTP Caching)

**Quyết định**
1. CDN mô phỏng là Nginx `proxy_cache`, ghim `nginx:1.30.5` (cùng digest với tag `stable` ngày 2026-10-07), cổng host **58088**. Bảng cổng của skill chưa có Nginx; phiên này không sửa skill. Cấu hình không có `proxy_cache_valid` hay `proxy_ignore_headers`, nên chỉ header của máy gốc quyết định lưu gì. Bộ nhớ cache đặt trên tmpfs để `docker compose restart` là cache trống. Log JSON có `$upstream_cache_status`, `$upstream_status` và `$upstream_connect_time`. Mẫu: `nginx/cdn.conf` và `docker-compose.yml` của bài 04/01.
2. Đo phía trình duyệt dùng Google Chrome đã cài trên máy, headless, profile tạm, không tải Chromium. Byte "Transferred" đo bằng `playwright-core` với `channel: 'chrome'`, đọc CDP `Network.*` (tổng `encodedDataLength`, tách memory cache, disk cache, 304, 200). LCP đo bằng Lighthouse 12.8.2 qua `chrome-launcher` trỏ vào Chrome hệ thống, dùng cấu hình mặc định (mobile, `simulate`); lượt lặp lại chạy với `disableStorageReset`. Lighthouse 13 đòi Node ≥ 22.19 nên lab trên Node 20 ghim bản 12.
3. k6 không có HTTP cache. Kịch bản "khách quay lại" phải mang theo cache riêng của mỗi khách (mẫu `bench/browser-cache.js`), và quyết định của cache đó phải được đối chiếu từng URL với Chrome thật trước khi dùng số (mẫu `emulationCheck` trong `bench/browser-bytes.ts`). "Lượt xem lặp lại" nghĩa là cùng khách xem lại đúng trang đã xem.
4. Test request có điều kiện không dùng `fetch()` của Node. Theo đặc tả Fetch, undici tự thêm `Cache-Control: no-cache` khi tự đặt `If-None-Match`, và Express/Next (gói `fresh`) khi đó trả `200`. Dùng `node:http` hoặc supertest.
5. Máy gốc chạy trên host, CDN trong container gọi qua `host.docker.internal`: hiếm khi một kết nối mới treo tới hết `proxy_connect_timeout` (60 giây). Lab ghi số lỗi cạnh chỉ số và không bỏ lượt đo vì lỗi này. Lab cần đo độ trễ đuôi qua CDN thì cân nhắc chạy máy gốc trong mạng Compose (chưa thử).

**Lý do:** (1) bảng cổng chưa có Nginx; tag `stable` trôi theo thời gian. (2) đề bài yêu cầu đo tự động trên Chrome có sẵn; byte đo bằng Playwright và bằng Lighthouse khớp nhau (3.117 B ở lượt lặp lại). (3) lần đối chiếu đầu tìm ra 2 URL lệch (`<script noModule>`, `/favicon.ico`); định nghĩa theo "khách quay lại" cho 304 = 17 % thay vì 100 % vì phần lớn là trang mới. (4) gặp thật khi viết test, kiểm lại bằng curl có và không có `Cache-Control: no-cache`. (5) 6 lần trong 3 lượt tải chính (lượt chẩn đoán: 1 trên 367 kết nối mới, 366 kết nối còn lại xong dưới 100 ms); lượt chạy lại từ volume sạch không gặp. Nguyên nhân chưa tách riêng được.
**Ảnh hưởng:** các bài còn lại của scope 04 (cache busting, stale-while-revalidate, service worker) dùng lại (1)–(4); lab có Nginx đặt ở 58088 khi không có lý do khác.


## 2026-10-08 — Quy ước lab rút ra từ bài 04/02 (Cache Busting)

**Quyết định**
1. Lab có hai bản (trước/sau) của một frontend tĩnh chạy song song trên cùng CDN Nginx 58088, tách theo tên miền `truoc.localhost` / `sau.localhost`. Chrome tự trỏ `*.localhost` về 127.0.0.1 (đã kiểm với Chrome 154); test bằng `node:http` thì gửi header `Host`. Khóa cache của CDN thêm `$host`. "Xóa cache CDN" là đổi thế hệ khóa cache rồi `nginx -s reload` (mẫu `scripts/cdn.ts`), vì purge là tính năng của bản Nginx thương mại. Máy gốc tĩnh là container `nginx:1.30.5` thứ hai, đọc bind mount thư mục deploy. Script deploy chỉ xóa nội dung, không xóa chính thư mục, để container không mất mount.
2. Build frontend gọi từ test hay script đo (tiến trình con của Vitest) phải ép `NODE_ENV=production`. Vitest đặt `NODE_ENV=test`, Vite giữ giá trị đó và đóng gói React bản development: vendor 425.677 B thay vì 218.775 B, hash khác.
3. Đo hành vi nhiều phiên trình duyệt (mẫu `bench/fleet.ts`): mỗi người dùng là một browser context của Chrome hệ thống (cache riêng), có PRNG riêng theo hạt để các bản nhận cùng chuỗi lựa chọn. Trạng thái phiên đọc từ trang (`window.__APP__`) theo mốc cố định, đọc đồng thời mọi tab. Lỗi lấy từ hai nguồn để đối chiếu: bộ đo inline gửi về API và `pageerror` của Playwright. k6 không thay được cho chỉ số cần JS thật chạy.
4. Test hay đo việc xóa file ở máy gốc phải xóa cache CDN trước, vì CDN giữ file `immutable` một năm nên che việc xóa (lần thử đầu của bài 04/02).
5. Máy đo phải thức suốt lượt: cắm sạc, mở nắp (hoặc `caffeinate` khi cắm sạc). Laptop gập nắp chạy pin vào "Clamshell Sleep" rồi chỉ chạy từng đợt DarkWake. `process.hrtime` của Node trên macOS này vẫn chạy trong lúc ngủ (đã kiểm), nên hẹn giờ hết hạn ngay khi máy thức. Script đo giờ ghi khoảng máy ngủ (`startSleepDetector` trong `bench/lib.ts`, hai nhịp 1 giây cách nhau quá 2,5 giây); lượt có khoảng ngủ phải chạy lại dưới tên khác, giữ file cũ. Lượt cũ đối chiếu bằng `pmset -g log` (mẫu `bench/sleep-overlap.ts`).
6. Vite 8.3.3 phát `vite:preloadError` cả khi chính chunk tải lười trả 404 (đã kiểm bằng test). Bài dựa vào sự kiện này phải ghi phiên bản Vite và giữ test.

**Lý do:** (1) cho phép test so hai bản trong một lượt mà không dựng lại container; (2), (4), (5) và (6) gặp thật trong bài 04/02. Với (5): ba lượt fleet ngủ 98 – 636 s, một test Chrome hết giờ sau 214 s.
**Ảnh hưởng:** các bài còn lại của scope 04 (stale-while-revalidate, optimistic UI, Service Worker) và bài frontend khác theo (1)–(4). Mọi lab đo theo thời gian thực theo (5). Bảng cổng của skill chưa sửa (phiên này không được sửa skill).

## 2026-10-08 — Quy ước lab rút ra từ bài 04/03 (Stale-While-Revalidate phía client)

**Quyết định**
1. Lab không cần dịch vụ hạ tầng nào (pattern nằm hoàn toàn ở client, dữ liệu trong bộ nhớ API, độ trễ giả lập) thì không tạo `docker-compose.yml`; "Cách chạy" bắt đầu từ `pnpm install`, mục 4 của bài ghi lý do. Bài 04/03 là bài đầu tiên như vậy.
2. Đo "thời gian tới khi thấy" trên trình duyệt bằng `MutationObserver` cài vào trang cộng khung hình `requestAnimationFrame` đầu tiên sau khi phần tử vào DOM, không dựa vào mã của app (mẫu `test/support/nav-probe.ts` của bài 04/03). Phần tử đếm phải là phần tử đang hiện (`checkVisibility()`): Next 16 bật `cacheComponents` giữ trang cũ trong DOM bằng `<Activity>` (`display: none`).
3. Đo độ cũ của dữ liệu đang hiển thị (thay cho poll ở bài 03/02 khi dữ liệu nằm ở client): API ghi số thứ tự và thời điểm của mọi thay đổi, response mang `seq` của bản chụp, trang ghi mỗi lần đổi thứ đang hiện; script phân tích dựng lại "đúng ra phải hiện gì" bằng chính hàm truy vấn của API (mẫu `bench/analyze-hour.ts`).
4. Script đo chạy bằng `tsx` mà gọi `page.evaluate` với hàm có tên bên trong thì thêm init script `globalThis.__name ??= (f) => f` khi tạo context (esbuild `keepNames` chèn `__name(...)`, trang không có hàm đó). Vitest không cần.
5. Ràng buộc nghiệp vụ "dữ liệu không cũ quá N giây khi đang xem" với TanStack Query v5 (đã kiểm 5.104.1): không đặt `refetchInterval` cố định bằng N. Bộ hẹn giờ khởi động lại lúc mount và mỗi lần truy vấn đổi trạng thái, nên khoảng giữa hai bản chụp là N + thời gian tải, và quay lại trong `staleTime` thì bản chụp kế tiếp tới N sau lúc quay lại. Dùng hàm theo tuổi dữ liệu (`dataUpdatedAt`) với N − độ trễ − lề.
6. Mỗi lượt đo ghi nguồn điện (`pmset -g batt`) cùng load; lượt dùng để so hai bản phải chạy cùng một nguồn điện, đổi nguồn giữa chừng thì chạy lại cặp đó. Chạy pin mà gập nắp thì máy vào "Clamshell Sleep" dù có `caffeinate -ims`.
7. Kịch bản nhiều phiên trên một bộ dữ liệu chung: PRNG chọn bản ghi phải tách theo từng bản (truoc/sau), nếu không các bản chọn đúng một bản ghi cùng lúc và tranh nhau (bài 04/03: 409 giả tạo ở lượt thử).
8. Kịch bản dài có thao tác tiêu thụ dữ liệu (phân đơn, mua hàng, nhận việc) phải có nguồn bổ sung tự cân bằng, để dữ liệu không cạn giữa lượt. Tính trước tốc độ vào/ra mỗi giờ và chạy thử ngắn trước lượt dài.

**Lý do:** (1) mọi lab trước đều có ít nhất một container. (2)–(3) gặp khi làm bài 04/03; (2) kiểm ở cả hai chế độ của Next 16.4.0 (`router-cache.json`). (4) lỗi `ReferenceError: __name is not defined` ở lượt thử đầu của `bench/back-nav.ts`. (5) phép thử âm của bài 04/03: `refetchInterval` cố định 30 s cho độ cũ 31.224 ms và 40.142 ms, cố định 28 s cho 38.225 ms; hàm theo tuổi dữ liệu cho tối đa 29,1 s trong lượt 30 phút (`hour-hour-2-summary.json`). (6) yêu cầu của người điều phối sau khi máy ngủ trong phiên (đến 14:42); sau đó máy còn ngủ hai lần vì gập nắp khi chạy pin (14:57 – 15:32, và 17:03 giữa lượt một giờ, lượt đó bị loại). (7) gặp ở lượt thử của `bench/hour.ts`. (8) lượt một giờ đầu tiên của bài 04/03 làm cạn đơn "Mới" sau khoảng 40 phút (ở Quận 1 vào khoảng 27 đơn/giờ, ra khoảng 190) và phải bỏ.
**Ảnh hưởng:** bài 04/04 (Optimistic UI), 04/05 (Normalized Cache), 04/06 (Service Worker) và các bài frontend khác dùng lại (2)–(4); bài nào có ràng buộc độ mới theo thời gian dùng (5); mọi lab đo theo (6). Bảng cổng của skill không đổi (lab dùng 3100, 3200).

## 2026-10-08 — Quy ước lab rút ra từ bài 01/01 (Contract-First API)

**Quyết định**
1. Công cụ CLI không phát hành trên npm (bài 01/01: oasdiff) chạy bằng `docker run --rm --network none -v <thư-mục-bài>:/lab:ro <image>:<tag>` với tag ghim (`tufin/oasdiff:v1.33.0`), không cài Homebrew. Lab vẫn không có `docker-compose.yml` khi không có dịch vụ chạy nền (nhật ký 04/03 điểm 1). "Cách chạy" ghi `docker pull <image>:<tag>` ở dòng đầu. Mẫu: `packages/api-contract/ci/steps.ts` của bài 01/01.
2. Bộ công cụ hợp đồng OpenAPI 3.1 cho lab trên Node 20 (đã kiểm 2026-10-08): `openapi-typescript` 7.13.0, `openapi-fetch` 0.17.0, Ajv 8.20.0 (`ajv/dist/2020`) + `ajv-formats` 3.0.1, Spectral CLI 6.16.3, Prism 5.14.2, oasdiff v1.33.0. Không lên bản mới hơn khi còn ở Node 20: Spectral 6.17.0 đòi Node `^22 || >=24`, Prism 5.15.x đòi Node ≥ 24.14 và 5.16.0 đòi ≥ 24.18 (`engines` trên registry). Cả sáu xử lý được các tính năng 3.1 mà bài 01/01 dùng (`type: [T, "null"]`, `examples` dạng mảng).
3. Bước CI chặn thay đổi phá vỡ bằng oasdiff phải có `--fail-on ERR`: thiếu cờ này oasdiff in lỗi nhưng thoát 0 (10/10 lần ở phép thử âm), giống `--output-type json` của dependency-cruiser (nhật ký 08/01 điểm 3). Lab hay bài viết về API nên giữ một test ghim hành vi này.
4. Kiểm request/response theo spec bằng Ajv thì nạp nguyên file spec (`addSchema(spec, id)`, `addVocabulary` cho các khóa gốc của OpenAPI, `ajv-formats`), rồi compile `{ $ref: id + '#' + JSON Pointer mã hóa URI }` tới nút `schema`. Không chép schema ra file khác. Test hợp đồng đi theo `operationId`, lấy tham số và body mẫu từ `example` trong spec, và có một test "mọi operation × status trong spec đều có case". Mẫu: `packages/api-contract/index.ts`, `test/support/contract-cases.ts`.
5. Script đo kiểu "áp thay đổi vào mã nguồn rồi chạy CI" (mẫu `bench/breaking-drills.ts`, theo nhật ký 08/01 điểm 4) phải khôi phục cả file **sinh ra** trong lượt (bài 01/01: `generated/schema.d.ts`), không chỉ file đã sửa. Snapshot cuối lượt phải gồm file sinh ra. Test dùng DI override không phụ thuộc type của lớp mà script sẽ sửa (ép qua `unknown`), nếu không `tsc` đỏ ở file test và làm sai chỉ số.

**Lý do:** (1) oasdiff là binary Go, image chính thức có bản arm64; `docker run` mỗi lần mất khoảng 0,3 s khi đã có image. (2)–(3) kiểm trực tiếp trong bài 01/01 (mục 4 và 5.1 của bài, `negative/negative.json`). (5) lượt thử đầu của bài 01/01: type sinh từ thay đổi #1 còn lại làm `tsc` của thay đổi #7 ở bản "trước" đỏ, bản trước bị tính nhầm là "bị chặn".
**Ảnh hưởng:** các bài còn lại của scope 01 (cursor pagination, idempotency key, BFF, gateway, API versioning) và bài schema evolution ở scope 13 dùng lại spec, validator và bộ công cụ ở (2); bài 01/07 (API versioning) dùng oasdiff theo (1) và (3). Danh mục nguồn của skill thêm một dòng "Công cụ OpenAPI" (mục C), theo yêu cầu của người điều phối.

## 2026-10-08 — Quy ước lab rút ra từ bài 01/02 (Cursor-based Pagination)

**Quyết định**
1. Lab có bảng lớn mà nhiều truy vấn song song (Parallel Bitmap Heap Scan, Parallel Seq Scan) chạy cùng lúc đặt `shm_size: 1gb` cho container PostgreSQL, thay cho 256 MB ở nhật ký 02/04 điểm 2. Mỗi lượt k6 kiểm tỉ lệ request đạt (status và nội dung) bằng 100 % trước khi dùng số độ trễ.
2. Lab có seed lớn (hàng triệu dòng) cho test tự sinh dữ liệu nhỏ trong schema riêng `lab_test`: pool `pg` đặt `options: '-c search_path=lab_test'`, file SQL của schema không ghi tên schema để nạp được vào cả hai. Test không cần seed lớn, chạy vài giây, và `kiem-chung-lab.mjs` chạy không cần `--seed`. Script đọc catalog (`pg_indexes`, `pg_stat_user_indexes`) phải lọc `schemaname = 'public'`, vì `lab_test` có object cùng tên.
3. Giá trị `timestamptz` đi vào khóa hay cursor giữ đủ micro giây: pool `pg` tắt bộ chuyển `timestamptz` → `Date` (tùy chọn `types` của pool, OID 1184) và câu SELECT đọc bằng `to_char(... AT TIME ZONE 'UTC', '...US"Z"')`. Bí danh của cột tính toán không trùng tên cột gốc: `ORDER BY created_at` khớp cột xuất ra trước, nên sắp theo chuỗi và bỏ index (đã kiểm bằng `EXPLAIN`).
4. Script đo có bộ phát hiện máy ngủ (nhật ký 04/02 điểm 5) không gọi `spawnSync`/`execSync` cho lệnh chạy lâu (k6, tạo index): chúng chặn event loop và bộ phát hiện báo ngủ sai. Script tự chạy API thì kiểm cổng trước và dừng nếu đã có tiến trình khác nghe. Mẫu: `bench/run-scroll.ts`, `bench/lib/api-process.ts` của bài 01/02.
5. Test React chạy trong môi trường happy-dom (đã dùng 20.14.5 trên Node 20): không đọc file bằng `new URL(đường-dẫn-tương-đối, import.meta.url)` vì happy-dom thay `URL` toàn cục; dùng `fileURLToPath` + `path.resolve`. Request của component đi qua `app.inject` của Fastify thay cho mạng.
6. Seed và test của bài về thứ tự hay phân trang phải chủ động tạo ranh giới trang cắt ngang nhóm giá trị trùng và kiểm điều đó trong test. Seed theo khối (bài 01/02: nhóm 5 dòng, trang 20) có thể làm ranh giới trang luôn trùng ranh giới nhóm, và lỗi "bỏ khóa phụ" không lộ ra.
7. k6 mô hình đóng (`constant-vus`) với pool kết nối nhỏ hơn số VU: độ trễ theo nhóm (ví dụ theo độ sâu trang) bị san phẳng vì mọi request chờ chung hàng đợi của pool. Đọc chi phí của từng loại request bằng `EXPLAIN` cạnh số k6, không suy từ độ trễ theo nhóm.

**Lý do:** (1) lượt thử đầu của bài 01/02 với 256 MB: 572 lỗi `could not resize shared memory segment`, chỉ 3,9 % request đạt. (2) seed 20 triệu dòng mất 1,5 phút, còn 32 test chạy khoảng 6 giây; lỗi lọc schema gặp ở lượt chạy lại (`hasIndex` đếm được 2 index). (3) và (6) gặp khi viết test và phép thử âm của bài. (4) lượt thử thứ hai báo một khoảng ngủ khi máy vẫn thức, và đo nhầm một API chạy sót ở cổng 3100. (5) test đọc nhầm `/db/schema.sql`. (7) OFFSET có index: `EXPLAIN` trang 1 là 0,03 ms, trang 500 là 8,2 ms, nhưng p95 dưới tải chỉ là 38,5 ms so với 47,1 ms.
**Ảnh hưởng:** các bài có PostgreSQL với seed lớn (02/05 read replica, 02/08 expand/contract, 02/09 partitioning, scope 05 search) theo (1)–(2); bài nào đưa thời gian vào khóa, cursor hay idempotency key theo (3); mọi script đo theo (4); bài frontend có test component theo (5); bài về phân trang, sắp xếp, hàng đợi có thứ tự theo (6). Bảng cổng của skill không đổi (lab dùng 55432 và 3100).

## 2026-10-08 — Quy ước lab rút ra từ bài 01/03 (Idempotency Key)

**Quyết định**
1. Lab cần tiêm lỗi mạng dùng Toxiproxy, ghim `ghcr.io/shopify/toxiproxy:2.12.0` (bản phát hành mới nhất ngày 2026-10-08, có arm64): cổng host **58474** (API điều khiển) và **58401** (proxy đầu tiên; proxy thêm 58402...), đã thêm vào bảng cổng của skill và biến `ports` của `kiem-chung-lab.mjs`. Proxy khai báo trong file `-config` (mount chỉ đọc); image không có shell nên healthcheck là `["CMD", "/toxiproxy-cli", "list"]`; sửa proxy bằng `PATCH /proxies/<tên>` (Toxiproxy 2.12 báo `POST` đã cũ). API của lab chạy trên host, proxy gọi ngược qua `host.docker.internal` (`extra_hosts: host-gateway`). Mẫu: `docker-compose.yml`, `toxiproxy/toxiproxy.json`, `bench/lib/toxiproxy.ts` của bài 01/03.
2. "Response mất sau khi server đã commit" tái hiện bằng toxic `limit_data` 0 byte ở chiều downstream: request tới server nguyên vẹn, response bị bỏ, client nhận "socket hang up" ngay. Muốn client phải chờ hết giờ thì dùng toxic `timeout` 0 ms ở downstream **và** kết nối keep-alive; với `Connection: close`, server đóng kết nối sau response và Toxiproxy đóng luôn phía client. Toxic áp cho mọi kết nối của proxy, nên kịch bản "chỉ cắt lần gửi đầu" chạy các ý định tuần tự.
3. Đường client → cổng Docker Desktop → container → `host.docker.internal` → host thỉnh thoảng nuốt response vài chục giây theo cụm (bài 01/03: 0,6 – 1,3 % ý định mỗi lượt 1.000, cả khi không có toxic nào), trong khi request vẫn tới server. Bench có lỗi mạng đếm kết quả đúng/sai bằng dữ liệu trong DB (theo mã ý định), không suy từ response client nhận, và ghi riêng số ý định không nhận được response. Bổ sung cho nhật ký 04/01 điểm 5; nguyên nhân chưa tách riêng được.
4. Phép thử âm cho tính nguyên tử giữa hai lần ghi (ví dụ "lưu khóa ngoài transaction nghiệp vụ") chèn lỗi bằng trigger trong schema test, dùng sequence vì `nextval` không rollback theo transaction: lần ghi thứ lẻ lỗi, lần thứ chẵn qua. Không cần móc test trong mã nguồn. Kịch bản lỗi mạng thuần (cắt response) không bắt được lỗi loại này (bài 01/03, phép thử âm #4: 0 giao dịch thừa trên 1.000 lần cắt).
5. Đo overhead nhỏ khi máy bận (load ≥ khoảng 6): chạy thêm mô hình đóng 1 VU (k6 `constant-vus`, mỗi request nối tiếp request trước), 3 vòng xoay thứ tự, bên cạnh tải cố định. Ở bài 01/03, 200 request/s cho chênh p95 từ +1,8 đến +16 ms tùy vòng; 1 VU cho +1,07 – 1,36 ms, ổn định giữa các vòng.
6. Lab NestJS trên máy này không `import type ... from 'express'` khi `express` không phải dependency trực tiếp: `tsc` phân giải nhầm sang `~/node_modules/express` (TS7016). Khai báo interface nhỏ cho phần request/response cần dùng, hoặc thêm `@types/express` và `express` vào `package.json` của bài.

**Lý do:** (1)–(2) kiểm trực tiếp ở bài 01/03 (lượt dò bằng curl và lượt thử của `bench/run-response-cut.ts`). (3) lượt đối chứng `check/no-cut.json` của bài 01/03. (4) phép thử âm #4 của bài 01/03. (5) máy bận suốt nửa sau phiên sau khi cắm sạc (`photoanalysisd`, `mds_stores`), 3/12 bước ở tải cố định phải bỏ vì k6 bỏ iteration. (6) gặp khi typecheck lần đầu.
**Ảnh hưởng:** các bài về retry, timeout, circuit breaker, webhook, idempotent consumer (scope 07, 13, 14) dùng Toxiproxy theo (1)–(3); bài nào chứng minh "hai lần ghi phải cùng commit" (transactional outbox 14/03, idempotent consumer 14/04) dùng cách (4).

## 2026-10-08 — Quy ước lab rút ra từ bài 19/01 (Password Hashing Argon2id)

**Quyết định**
1. Thư viện Argon2 cho lab trên Node 20 arm64: dùng `@node-rs/argon2` (napi-rs, ghim `2.2.2`), KHÔNG dùng `argon2` (node-argon2). node-argon2 `0.45.1` có prebuild cho `darwin-arm64` nhưng file lại là binary Linux (`argon2.armv8.glibc.node`), `require` làm Node thoát mã 139 (SIGSEGV); `@node-rs/argon2` có gói nền tảng riêng `@node-rs/argon2-darwin-arm64` cài sạch không cần build script. Khác biệt API cần nhớ: `@node-rs/argon2` KHÔNG có `needsRehash` (tự parse bằng `parseOptions` rồi so tham số), pepper truyền qua tùy chọn `secret` (không nằm trong chuỗi PHC), `verify` sai mật khẩu/sai secret trả `false` không ném.
2. Controller/service NestJS của lab `@Inject(<lớp>)` tường minh cho MỌI tham số constructor (nhắc lại nhật ký 08/01 điểm 1, nay gặp ở controller): `tsx` (esbuild) không phát `design:paramtypes` nên `pnpm dev`/bench lỗi "Cannot read properties of undefined" trong khi test Vitest (oxc) vẫn xanh — lỗi bị ẩn nếu chỉ chạy test. Trial bằng `run-login.ts` (chạy app thật qua tsx) mới lộ; luôn chạy một lượt qua tiến trình thật trước khi tin.
3. Chọn tham số slow-hash bằng benchmark trên máy đích (RFC 9106 §4, OWASP): quét tập ứng viên đều ở mức ≥ tối thiểu OWASP cho web, chọn bộ có trung vị gần dải mục tiêu (~100–150 ms) nhất, ưu tiên bộ nhớ cao hơn khi hòa. Bài 19/01 chốt Argon2id m=65536 KiB (64 MiB), t=5, p=1 (khớp "lựa chọn thứ hai" của RFC 9106 về bộ nhớ; p=1 để dễ kiểm soát threadpool). Migration bọc 10.000 hash tốn vài phút ở tham số thật — chấp nhận là chi phí một lần, có `MIGRATE_LIMIT` cho lượt thử.
4. "Kẻ tấn công" từ điển: KHÔNG tải danh sách mật khẩu lộ từ Internet; sinh từ điển tổng hợp 100.000 ứng viên bằng code deterministic (`bench/lib/dictionary.ts`), mật khẩu seed lấy theo phân phối từ chính tập đó (nhãn "minh họa" cho giả định phân phối, "đã đo" cho tốc độ thử và số bẻ được). Mật khẩu seed là dữ liệu tổng hợp, KHÔNG ghi ra file, sinh lại từ hạt. Với slow-hash có salt, không precompute được: đo tốc độ verify/giây (đã đo) rồi ngoại suy thời gian bẻ theo vị trí mật khẩu trong từ điển (ghi rõ "ngoại suy"); bẻ thật một tập con mật khẩu phổ biến (vị trí nhỏ) trong ngân sách verify để đối chứng.
5. Argon2 chạy trên threadpool của libuv: số hash song song bị chặn bởi `UV_THREADPOOL_SIZE`; đo login dưới tải phải ghi giá trị này và ảnh hưởng tới thông lượng. Redis cho bộ đếm sai đặt `enableOfflineQueue: false` nên test phải chờ sự kiện `ready` trước khi gọi lệnh; đăng nhập xử lý lỗi Redis theo hướng fail-open (không chặn, ghi log) để sự cố Redis không khóa người dùng.

**Lý do:** (1) kéo `argon2@0.45.1` rồi `import` thoát mã 139; `@node-rs/argon2` chạy ngay (đã kiểm hash/verify/parseOptions/secret). (2) lượt trial `run-login.ts` đầu tiên trả 500 toàn bộ bản sau trong khi 12/12 test vẫn xanh. (3)–(4) số đo ở mục 5.1 bài 19/01. (5) kiểm trực tiếp khi viết test rate-limit.
**Ảnh hưởng:** các bài còn lại của scope 19 (session/JWT, OAuth, refresh token, MFA) và bài nào băm mật khẩu dùng `@node-rs/argon2` theo (1) và `@Inject` tường minh theo (2); bài có bộ đếm/khóa trong Redis theo (5). Bảng cổng của skill không đổi (lab dùng 55432 và 56379).

## 2026-10-09 — Sửa lỗi bài 19/01: migration hash phải xóa hash cũ; bench tấn công phải dùng cả dump

**Quyết định (quy ước dùng chung cho mọi bài về lưu bí mật / di trú hash)**
1. **Di trú hash phải XÓA hash cũ trong cùng một câu lệnh ghi**, không chỉ thêm hash mới. Bài 19/01 bọc `argon2id(md5)` nhưng ban đầu giữ nguyên cột `password_md5`, nên một bản dump sau migration VẪN lộ 85 % mật khẩu qua cột MD5 không salt. Migration (`UPDATE ... SET password_hash=..., hash_version=1, password_md5=NULL`) và nâng cấp khi đăng nhập (`rehash`) đều phải đặt cột cũ về NULL cùng lúc; cột cũ khai `NULL` được. Bài nào thay một cách lưu bí mật bằng cách khác (re-encrypt, đổi KDF, xoay khóa) theo cùng nguyên tắc.
2. **Script tấn công / kiểm lộ dữ liệu phải thử MỌI cột của bản dump**, không chỉ cột "mới". Bench `crack-dictionary.ts` của 19/01 lúc đầu chỉ tấn công `password_hash` nên báo "0 % khi không lộ pepper" trong khi cột `password_md5` vẫn bẻ được 85 %. Nay bench chạy ở hai thời điểm (trước/sau migration) và mỗi lần tấn công cả cột MD5 lẫn cột Argon2id của dump hiện tại.
3. **Phép thử âm và test phải kiểm bất biến ở mức BẢN GHI/BẢNG, không chỉ ở đường đi mới.** Lỗi trên lọt qua 12 test và 4 phép thử âm vì tất cả chỉ kiểm cột `password_hash`; thêm test "sau migration/nâng cấp không còn dòng nào mang hash cũ" (đếm `WHERE cột_cũ IS NOT NULL = 0`) và phép thử âm bỏ bước xóa thì test đỏ. Khi pattern là "loại bỏ một dạng dữ liệu nguy hiểm", test phải khẳng định dạng đó biến mất khỏi kho, không chỉ khẳng định dạng mới tồn tại.
4. **Không đổi schema mà dùng lại volume cũ; không đọc kết quả script dài qua `| tail`.** Khi sửa file nạp vào `docker-entrypoint-initdb.d` (ở đây bỏ `NOT NULL`), phải `docker compose down -v` rồi dựng lại: schema `public` chỉ nạp lúc tạo volume, còn test vẫn xanh vì tự dựng lại `lab_test` từ file mới — lần chạy lại migration đầu tiên của bản sửa vỡ vì `NOT NULL` cũ. Lệnh nền dạng `tsx script.ts | tail -3` báo exit 0 (mã của `tail`) và cắt mất dòng lỗi: ghi đủ ra file log và lưu `$?` của chính script (hoặc `set -o pipefail`), rồi kiểm trạng thái DB sau đó.

**Lý do:** người điều phối tái hiện khi kiểm đầu cuối (chèn user, migrate, đăng nhập, rồi `SELECT password_md5` thấy MD5 còn nguyên). Bản sửa: schema cho `password_md5` NULL; `src/sau/wrap-legacy-migration.ts` (dùng chung script + test) xóa MD5 cùng câu bọc; `LoginService.rehash` xóa MD5; `test/migration.test.ts` + 2 phép thử âm; `bench/crack-dictionary.ts` tấn công cả dump, đo lại vào `bench/results/fix/`.
**Ảnh hưởng:** các bài scope 19 còn lại (refresh token rotation 19/04 — thu hồi token cũ, BFF 19/05) và bài về re-encrypt / xoay khóa / soft-delete bí mật theo (1)–(3). Số p95 `/login` và tham số Argon2id của 19/01 không đổi (lỗi nằm ở việc giữ cột cũ, không ở đường băm), chỉ đo lại phần crack.
