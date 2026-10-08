# Tiến độ thực hành

> Sinh tự động bởi `node scripts/tao-tien-do.mjs` ngày 2026-10-08. **Không sửa tay** — sửa README của bài rồi chạy lại script.

## Tổng quan

| Tổng số bài | 📋 Kế hoạch | 🔨 Đang làm | ✅ Hoàn thành |
|---|---|---|---|
| 193 | 177 | 0 | 16 |

## Theo scope

| Scope | Số bài | 🟢 | 🟡 | 🔴 | 📋 | 🔨 | ✅ |
|---|---|---|---|---|---|---|---|
| [01 · Giao tiếp Frontend ↔ Backend (`frontend / backend / transporter`)](./01-frontend-backend-transporter/) | 7 | 2 | 4 | 1 | 4 | 0 | 3 |
| [02 · Cơ sở dữ liệu quan hệ (`backend / database`)](./02-backend-database/) | 9 | 2 | 3 | 4 | 5 | 0 | 4 |
| [03 · Cache phía backend (`backend / cache`)](./03-backend-cache/) | 6 | 2 | 2 | 2 | 4 | 0 | 2 |
| [04 · Cache phía frontend (`frontend / cache`)](./04-frontend-cache/) | 6 | 3 | 2 | 1 | 3 | 0 | 3 |
| [05 · Tìm kiếm (`backend / search`)](./05-backend-search/) | 7 | 2 | 2 | 3 | 7 | 0 | 0 |
| [06 · Thời gian thực (`frontend / backend / realtime`)](./06-frontend-backend-realtime/) | 7 | 1 | 3 | 3 | 7 | 0 | 0 |
| [07 · Microservices (`backend / microservices`)](./07-backend-microservices/) | 8 | 2 | 4 | 2 | 8 | 0 | 0 |
| [08 · Monolith (`backend / monolithics`)](./08-backend-monolith/) | 7 | 2 | 3 | 2 | 5 | 0 | 2 |
| [09 · Monorepo (`backend / monorepo`)](./09-backend-monorepo/) | 6 | 2 | 3 | 1 | 6 | 0 | 0 |
| [10 · AI — RAG (`backend / AI RAG`)](./10-backend-ai-rag/) | 9 | 2 | 5 | 2 | 9 | 0 | 0 |
| [11 · AI — Agent (`backend / AI Agent`)](./11-backend-ai-agent/) | 9 | 3 | 3 | 3 | 9 | 0 | 0 |
| [12 · Cơ sở dữ liệu vector (`backend / database / vector`)](./12-backend-database-vector/) | 7 | 1 | 3 | 3 | 7 | 0 | 0 |
| [13 · Giao tiếp giữa các service (`backend / transporter`)](./13-backend-transporter/) | 7 | 1 | 4 | 2 | 7 | 0 | 0 |
| [14 · Hàng đợi và message queue (`backend / queueing / message queueing`)](./14-backend-queueing/) | 9 | 2 | 5 | 2 | 9 | 0 | 0 |
| [15 · Lưu trữ file và object (`backend / storage`)](./15-backend-storage/) | 8 | 2 | 5 | 1 | 8 | 0 | 0 |
| [16 · Kubernetes (`backend / k8s`)](./16-backend-k8s/) | 9 | 2 | 4 | 3 | 9 | 0 | 0 |
| [17 · Docker (`backend / docker`)](./17-backend-docker/) | 8 | 4 | 3 | 1 | 8 | 0 | 0 |
| [18 · Mở rộng dọc và ngang (`backend / vertical / horizontal scale`)](./18-backend-scale/) | 8 | 2 | 3 | 3 | 8 | 0 | 0 |
| [19 · Xác thực và phân quyền (`backend / frontend / authenticate`)](./19-backend-frontend-authenticate/) | 10 | 2 | 5 | 3 | 8 | 0 | 2 |
| [20 · Thiết kế hệ thống AI framework, cơ bản → nâng cao (`backend / AI framework system design`)](./20-backend-ai-framework-system-design/) | 10 | 3 | 4 | 3 | 10 | 0 | 0 |
| [21 · Hạ tầng AI (`backend / AI infrastructure`)](./21-backend-ai-infrastructure/) | 8 | 2 | 4 | 2 | 8 | 0 | 0 |
| [22 · Tối ưu AI: chi phí, độ trễ, chất lượng (`backend / AI optimizer`)](./22-backend-ai-optimizer/) | 10 | 4 | 4 | 2 | 10 | 0 | 0 |
| [23 · Giám sát và benchmark (`backend / monitoring benchmark`)](./23-backend-monitoring-benchmark/) | 9 | 4 | 3 | 2 | 9 | 0 | 0 |
| [24 · Giám sát AI (`backend / AI monitoring`)](./24-backend-ai-monitoring/) | 9 | 2 | 6 | 1 | 9 | 0 | 0 |

## Chi tiết

### 01 · Giao tiếp Frontend ↔ Backend (`frontend / backend / transporter`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Contract-First API (OpenAPI) — Frontend gọi sai tên trường, lỗi chỉ lộ khi chạy](./01-frontend-backend-transporter/01-contract-first-openapi-frontend-goi-sai-ten-truong/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-08 |
| [Cursor-based Pagination — Trang 500 của lịch sử giao dịch mất 6 giây và lặp bản ghi](./01-frontend-backend-transporter/02-cursor-pagination-trang-500-lich-su-giao-dich/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-08 |
| [Idempotency Key — Khách bấm "Thanh toán" hai lần vì mạng chập chờn, bị trừ tiền hai lần](./01-frontend-backend-transporter/03-idempotency-key-bam-thanh-toan-hai-lan/) | 🟡 Trung bình | ✅ Hoàn thành | 2026-10-08 |
| [Backend for Frontend (BFF) — Web, mobile và app đối tác cần hình dạng dữ liệu khác nhau từ cùng một hệ thống](./01-frontend-backend-transporter/04-bff-web-mobile-can-du-lieu-khac-nhau/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [API Gateway — App di động phải gọi 7 service nội bộ để vẽ một màn hình](./01-frontend-backend-transporter/05-api-gateway-mobile-goi-bay-service/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [GraphQL — Màn hình dashboard tải 2 MB JSON nhưng chỉ hiển thị 12 trường](./01-frontend-backend-transporter/06-graphql-dashboard-tai-2mb-hien-12-truong/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [API Versioning — App cũ trên máy khách chưa cập nhật vẫn phải chạy sau khi backend đổi API](./01-frontend-backend-transporter/07-api-versioning-app-cu-van-phai-chay/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 02 · Cơ sở dữ liệu quan hệ (`backend / database`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [N+1 Query & Indexing — Trang danh sách 50 đơn hàng bắn 151 câu SQL](./02-backend-database/01-n-plus-1-trang-50-don-ban-151-cau-sql/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-06 |
| [Optimistic Offline Lock — Hai nhân viên cùng sửa một đơn, người lưu sau ghi đè người lưu trước](./02-backend-database/02-optimistic-lock-hai-nhan-vien-cung-sua-mot-don/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Connection Pooling — 200 pod × 20 kết nối làm PostgreSQL cạn max_connections](./02-backend-database/03-connection-pool-200-pod-dap-postgres/) | 🟡 Trung bình | ✅ Hoàn thành | 2026-10-07 |
| [Audit Log & Soft Delete — Kiểm toán hỏi "ai đổi giá hợp đồng lúc nào", DB chỉ còn giá mới](./02-backend-database/04-audit-log-ai-doi-gia-hop-dong-luc-nao/) | 🟡 Trung bình | ✅ Hoàn thành | 2026-10-07 |
| [Read Replica — Báo cáo cuối tháng làm chậm việc tạo đơn](./02-backend-database/05-read-replica-bao-cao-cuoi-thang-lam-cham-tao-don/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [CQRS — Màn hình tổng hợp phải join 9 bảng, mô hình ghi và đọc ngày càng khác nhau](./02-backend-database/06-cqrs-man-hinh-tong-hop-join-9-bang/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Multi-tenant Data Isolation — SaaS bán cho 300 công ty: chung bảng, chung DB hay riêng DB?](./02-backend-database/07-multi-tenant-saas-300-cong-ty-chung-mot-db/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Expand/Contract (Parallel Change) — Đổi tên cột trên bảng 100 triệu dòng mà không dừng dịch vụ](./02-backend-database/08-expand-contract-doi-ten-cot-100-trieu-dong/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Table Partitioning & Sharding — Bảng sự kiện 500 triệu dòng, xóa dữ liệu cũ mất 2 giờ](./02-backend-database/09-partitioning-bang-su-kien-500-trieu-dong/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 03 · Cache phía backend (`backend / cache`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Cache-Aside — Trang sản phẩm được đọc 10.000 lần/phút nhưng chỉ đổi 2 lần/ngày](./03-backend-cache/01-cache-aside-trang-san-pham-doc-10k-lan-phut/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Cache Invalidation (TTL + event-driven) — Đổi giá rồi mà khách vẫn thấy giá cũ 15 phút](./03-backend-cache/02-ttl-va-invalidation-gia-doi-roi-khach-van-thay-gia-cu/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Cache Stampede Prevention (lock / lease / early expiration) — Flash sale: key hết hạn đúng lúc 50k người vào, DB sập](./03-backend-cache/03-cache-stampede-flash-sale-cache-het-han-db-sap/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Write-Through / Write-Behind — Số dư ví phải mới tức thì nhưng DB không chịu nổi mọi lần ghi](./03-backend-cache/04-write-through-write-behind-so-du-vi-can-moi-tuc-thi/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Hot Key & Multi-tier Cache — Một sản phẩm viral làm một node Redis quá tải trong khi các node khác rảnh](./03-backend-cache/05-hot-key-mot-san-pham-viral-dap-mot-node-redis/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Distributed Lock — Hai worker cùng chạy một job đối soát, ghi trùng kết quả](./03-backend-cache/06-distributed-lock-hai-worker-cung-chay-mot-job/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 04 · Cache phía frontend (`frontend / cache`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [HTTP Caching (Cache-Control, ETag) — Ảnh và JS tải lại mỗi lần, hóa đơn CDN tăng](./04-frontend-cache/01-http-cache-headers-anh-san-pham-tai-lai-moi-lan/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Cache Busting (content hash + immutable) — Deploy xong, nửa người dùng vẫn chạy JS cũ gọi API mới](./04-frontend-cache/02-cache-busting-deploy-xong-user-van-chay-js-cu/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-08 |
| [Stale-While-Revalidate (client) — Quay lại trang danh sách đơn lại thấy vòng xoay loading](./04-frontend-cache/03-stale-while-revalidate-quay-lai-trang-lai-thay-loading/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-08 |
| [Optimistic UI — Bấm "Thích" / "Thêm vào giỏ" phải chờ 1 giây mới thấy phản hồi](./04-frontend-cache/04-optimistic-ui-bam-thich-cho-mot-giay/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Normalized Client Cache — Cùng một khách hàng hiển thị tên cũ ở màn này, tên mới ở màn kia](./04-frontend-cache/05-normalized-cache-mot-user-hai-ten-khac-nhau/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Service Worker Caching Strategies (offline-first) — Shipper mất mạng trong hầm vẫn phải xem được danh sách đơn](./04-frontend-cache/06-service-worker-shipper-mat-mang-van-xem-don/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 05 · Tìm kiếm (`backend / search`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Inverted Index Full-text Search — Tìm "ao thun nam" bằng LIKE mất 8 giây và không ra "Áo Thun Nam"](./05-backend-search/01-full-text-vs-like-tim-ao-thun-nam-mat-8-giay/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Text Analysis for Vietnamese (tokenizer + folding) — Gõ "ha noi" không ra "Hà Nội", gõ "iphone15" không ra "iPhone 15"](./05-backend-search/02-vietnamese-analyzer-tim-ha-noi-ra-ha-noi/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Autocomplete / Search-as-you-type — Gợi ý sau 3 ký tự dưới 100 ms cho 2 triệu sản phẩm](./05-backend-search/03-autocomplete-goi-y-khi-go-3-ky-tu/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Faceted Search (aggregations) — Bộ lọc thương hiệu/giá/size phải hiện số lượng kết quả cho từng lựa chọn](./05-backend-search/04-faceted-search-bo-loc-thuong-hieu-gia-size-kem-so-luong/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [CDC-based Index Sync — Dữ liệu trong search lệch với DB sau mỗi lần sửa giá](./05-backend-search/05-cdc-dong-bo-index-du-lieu-search-lech-db/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Relevance Tuning (BM25 + boosting) — Sản phẩm bán chạy nhất nằm ở trang 3 kết quả](./05-backend-search/06-relevance-tuning-san-pham-ban-chay-nam-trang-3/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Zero-downtime Reindex (alias swap) — Đổi mapping bắt buộc reindex 50 triệu tài liệu mà search không được dừng](./05-backend-search/07-zero-downtime-reindex-doi-mapping-50-trieu-doc/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 06 · Thời gian thực (`frontend / backend / realtime`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [SSE vs WebSocket vs Polling — Khách muốn thấy trạng thái đơn đổi ngay, app hiện hỏi server mỗi 5 giây](./06-frontend-backend-realtime/01-sse-vs-websocket-vs-polling-theo-doi-trang-thai-don/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Pub/Sub Fan-out (Redis adapter) — Chạy 3 server WebSocket, tin nhắn của A ở server 1 không tới B ở server 2](./06-frontend-backend-realtime/02-pubsub-fanout-3-server-socket-nguoi-a-khong-thay-nguoi-b/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Reconnect & Resume (Last-Event-ID / sequence) — Mất mạng 10 giây là mất thông báo trong khoảng đó](./06-frontend-backend-realtime/03-reconnect-resume-mat-mang-10-giay-mat-thong-bao/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Presence (heartbeat + TTL) — Hiển thị "đang online / đang gõ" cho 50k người dùng đồng thời](./06-frontend-backend-realtime/04-presence-ai-dang-online-ai-dang-go/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Server-side Ordering — Hai người đặt giá đấu cùng một mili-giây: ai thắng, và mọi màn hình thấy cùng một kết quả](./06-frontend-backend-realtime/05-server-side-ordering-dau-gia-hai-nguoi-bid-cung-luc/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Backpressure & Batching — Bảng giá đấu giá nhận 200 cập nhật/giây, trình duyệt đơ](./06-frontend-backend-realtime/06-backpressure-throttle-bang-gia-200-cap-nhat-giay/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Collaborative Editing (CRDT / OT) — Nhiều người cùng sửa một báo giá, thay đổi của nhau ghi đè](./06-frontend-backend-realtime/07-crdt-nhieu-nguoi-cung-sua-mot-bao-gia/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 07 · Microservices (`backend / microservices`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Decompose by Bounded Context — Tách service theo nghiệp vụ (đơn hàng, kho, thanh toán) thay vì theo bảng](./07-backend-microservices/01-decomposition-bounded-context-tach-service-theo-nghiep-vu/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Database per Service — Hai service cùng ghi vào một bảng, đổi schema một bên làm hỏng bên kia](./07-backend-microservices/02-database-per-service-hai-service-cung-sua-mot-bang/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Circuit Breaker — Service khuyến mãi chậm 30 giây kéo sập toàn bộ checkout](./07-backend-microservices/03-circuit-breaker-service-khuyen-mai-cham-lam-sap-checkout/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Timeouts, Retries, Backoff with Jitter — Retry đồng loạt sau sự cố tạo cơn bão request thứ hai](./07-backend-microservices/04-timeout-retry-backoff-jitter-retry-dong-loat-tao-bao-moi/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [API Composition — Màn hình chi tiết đơn cần dữ liệu từ 4 service, ghép ở đâu?](./07-backend-microservices/05-api-composition-man-hinh-don-hang-can-du-lieu-4-service/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Service Discovery — Service deploy lại đổi IP, các service khác gọi vào địa chỉ cũ](./07-backend-microservices/06-service-discovery-service-moi-deploy-doi-ip/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Saga (choreography vs orchestration) — Đặt hàng → trừ kho → thanh toán: bước 3 lỗi thì hoàn kho thế nào khi không còn transaction chung](./07-backend-microservices/07-saga-dat-hang-tru-kho-thanh-toan-hoan-tien-khi-loi/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Bulkhead — Một khách hàng lớn chiếm hết pool kết nối, mọi khách khác bị lỗi theo](./07-backend-microservices/08-bulkhead-mot-tenant-lon-chiem-het-thread-pool/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 08 · Monolith (`backend / monolithics`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Layered Architecture — Logic nghiệp vụ nằm trong controller, không test được, sửa một chỗ hỏng ba chỗ](./08-backend-monolith/01-layered-architecture-logic-nam-trong-controller/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Background Jobs in a Monolith — Xuất Excel 50k dòng làm treo tiến trình web](./08-backend-monolith/02-background-job-trong-monolith-xuat-excel-lam-treo-web/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-07 |
| [Transaction Script vs Domain Model — Hàm tính phí bảo hiểm 1.200 dòng if/else không ai dám sửa](./08-backend-monolith/03-domain-model-vs-transaction-script-tinh-phi-bao-hiem-1200-dong/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Hexagonal Architecture (Ports & Adapters) — Đổi cổng thanh toán phải sửa 20 file nghiệp vụ](./08-backend-monolith/04-hexagonal-architecture-doi-cong-thanh-toan-phai-sua-20-file/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Modular Monolith — 15 người cùng sửa một codebase, module nào cũng import module nào](./08-backend-monolith/05-modular-monolith-team-15-nguoi-dung-nhau-trong-mot-codebase/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Feature Toggle & Branch by Abstraction — Refactor lớn kéo dài 2 tháng nhưng vẫn phải release hằng tuần](./08-backend-monolith/06-feature-toggle-branch-by-abstraction-refactor-lon-van-release-hang-tuan/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Strangler Fig — Tách module thanh toán ra khỏi monolith mà không dừng hệ thống](./08-backend-monolith/07-strangler-fig-tach-thanh-toan-ra-khoi-monolith-khong-dung-he-thong/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 09 · Monorepo (`backend / monorepo`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Workspaces & Shared Packages — Sửa một hàm trong thư viện chung phải mở 12 PR ở 12 repo](./09-backend-monorepo/01-workspace-sua-shared-lib-phai-mo-12-pr/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Code Ownership & Review Routing — 60 người trong một repo, không biết ai phải review thư mục nào](./09-backend-monorepo/02-codeowners-ai-review-thu-muc-nao/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Affected Graph & Remote Cache — CI chạy 40 phút cho mỗi commit dù chỉ sửa một README](./09-backend-monorepo/03-affected-graph-ci-chay-40-phut-cho-moi-commit/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Enforced Module Boundaries — Frontend import thẳng vào repository của backend vì "cùng repo"](./09-backend-monorepo/04-module-boundaries-frontend-import-thang-vao-repository-backend/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Trunk-based Development — Nhánh sống 3 tuần, merge xong là nửa ngày sửa conflict](./09-backend-monorepo/05-trunk-based-development-branch-song-3-tuan-merge-hell/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Independent Versioning (Changesets) — Mỗi lần release phải nhớ tay package nào đổi để tăng version](./09-backend-monorepo/06-versioning-release-xuat-ban-package-noi-bo-theo-changeset/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 10 · AI — RAG (`backend / AI RAG`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Naive RAG (retrieve → augment → generate) — Chatbot hỏi nội quy công ty trả lời bịa vì model không có tài liệu](./10-backend-ai-rag/01-naive-rag-chatbot-noi-quy-cong-ty-tra-loi-bua/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Chunking Strategies — Chunk cắt ngang giữa điều khoản, câu trả lời thiếu nửa điều kiện](./10-backend-ai-rag/02-chunking-cat-giua-dieu-khoan-tra-loi-thieu-nghia/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Hybrid Search (BM25 + vector, RRF) — Hỏi mã sản phẩm "SKU-4821", tìm bằng vector không ra](./10-backend-ai-rag/03-hybrid-search-rrf-ma-san-pham-tim-vector-khong-ra/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Reranking (cross-encoder) — Tài liệu đúng có trong top 20 nhưng không lọt top 5 đưa vào prompt](./10-backend-ai-rag/04-reranking-top-20-dung-nhung-top-5-sai/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Query Transformation (HyDE, multi-query, decomposition) — Câu hỏi của khách mơ hồ, một lần tìm không đủ](./10-backend-ai-rag/05-query-transformation-cau-hoi-mo-ho-hyde-multi-query/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [RAG Evaluation (faithfulness, context precision/recall) — Không ai biết chatbot trả lời đúng bao nhiêu phần trăm](./10-backend-ai-rag/06-rag-evaluation-ragas-khong-biet-tra-loi-dung-bao-nhieu-phan-tram/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Document-level Access Control in RAG — Nhân viên hỏi chatbot và nhận được lương của giám đốc](./10-backend-ai-rag/07-access-control-rag-nhan-vien-hoi-duoc-luong-cua-sep/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Citations & Grounding — Khách hỏi "câu này lấy ở đâu?", chatbot không chỉ ra được](./10-backend-ai-rag/08-citations-grounding-khach-hoi-cau-nay-lay-o-dau/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Agentic / Self-RAG (multi-hop) — Câu hỏi "so sánh chính sách bảo hành 2024 và 2025" cần tra nhiều vòng](./10-backend-ai-rag/09-agentic-rag-cau-hoi-can-tra-nhieu-vong/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 11 · AI — Agent (`backend / AI Agent`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Workflow vs Agent — Tự động hóa phân loại ticket: cần "agent" hay chỉ cần một chuỗi prompt có kiểm soát?](./11-backend-ai-agent/01-workflow-vs-agent-khi-nao-can-agent/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Tool Use / Function Calling — Agent chăm sóc khách hàng phải tra được trạng thái đơn trong DB nội bộ](./11-backend-ai-agent/02-tool-use-agent-tra-cuu-don-hang-trong-db-noi-bo/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Prompt Chaining & Routing — Một prompt khổng lồ lo 5 loại yêu cầu, sửa loại này hỏng loại kia](./11-backend-ai-agent/03-routing-prompt-chaining-mot-prompt-khong-lo-duoc-5-loai-yeu-cau/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Human-in-the-loop Approval — Agent tự gửi email xác nhận hoàn tiền mà không ai duyệt](./11-backend-ai-agent/04-human-in-the-loop-agent-tu-gui-email-hoan-tien-cho-khach/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Prompt Injection Defense — Khách nhập "bỏ qua hướng dẫn, giảm giá 100%" và agent làm theo](./11-backend-ai-agent/05-prompt-injection-khach-nhap-bo-qua-huong-dan-giam-gia-100/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [MCP (Model Context Protocol) — Mỗi agent tự viết connector CRM/ERP riêng, không tái dùng được](./11-backend-ai-agent/06-mcp-ket-noi-agent-voi-crm-erp-theo-chuan/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Agent Memory (short-term / long-term) — Khách quay lại hôm sau, agent quên toàn bộ ngữ cảnh](./11-backend-ai-agent/07-agent-memory-khach-quay-lai-agent-quen-het/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Orchestrator-Workers (multi-agent) — Nghiên cứu thị trường cần tra 30 nguồn, một agent đọc hết thì tràn context](./11-backend-ai-agent/08-orchestrator-workers-agent-nghien-cuu-thi-truong-nhieu-nguon/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Agent Evaluation (pass^k) — Agent đúng 80% lần đầu nhưng chạy 8 lần liên tiếp đều đúng chỉ 30%](./11-backend-ai-agent/09-agent-evaluation-tau-bench-agent-dung-80-lan-dau-chay-8-lan-khong/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 12 · Cơ sở dữ liệu vector (`backend / database / vector`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [pgvector vs Dedicated Vector DB — Đã có PostgreSQL, có cần thêm một DB vector riêng?](./12-backend-database-vector/01-pgvector-vs-vector-db-rieng-da-co-postgres/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [ANN Index: HNSW vs IVFFlat — Tìm sản phẩm tương tự trong 5 triệu ảnh bằng brute force mất 3 giây](./12-backend-database-vector/02-hnsw-vs-ivfflat-tim-san-pham-tuong-tu-5-trieu-anh-brute-force-3-giay/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Filtered Vector Search (pre/post-filter) — Tìm tương tự nhưng chỉ trong dữ liệu của tenant X, filter sau làm top-k rỗng](./12-backend-database-vector/03-metadata-filtering-tim-tuong-tu-nhung-chi-trong-tenant-x/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Quantization (scalar / product / binary) — 100 triệu vector × 1536 chiều = 600 GB RAM](./12-backend-database-vector/04-quantization-100-trieu-vector-600gb-ram/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Embedding Model Versioning & Re-embedding — Đổi model embedding, 20 triệu vector cũ không so được với vector mới](./12-backend-database-vector/05-embedding-versioning-doi-model-embedding-phai-re-embed-tat-ca/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Multi-tenancy in Vector DB — 10.000 tenant, mỗi tenant một collection làm cạn RAM](./12-backend-database-vector/06-multi-tenancy-vector-10k-tenant-moi-tenant-mot-collection/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Recall / Latency Trade-off (ef, M, nprobe) — Tăng tốc gấp 10 nhưng recall rớt từ 0,99 xuống 0,80](./12-backend-database-vector/07-recall-vs-latency-benchmark-ann-chon-tham-so-ef-m/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 13 · Giao tiếp giữa các service (`backend / transporter`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [REST/JSON vs gRPC/Protobuf — Serialize JSON chiếm 30% CPU, contract giữa service không rõ](./13-backend-transporter/01-rest-vs-grpc-json-serialize-chiem-30-phan-tram-cpu/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Schema Evolution & Backward Compatibility — Thêm một field làm consumer cũ sập](./13-backend-transporter/02-schema-evolution-them-field-lam-sap-consumer-cu/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Rate Limiting & Throttling — Một khách hàng API gọi 10k req/s làm chậm tất cả khách khác](./13-backend-transporter/03-rate-limiting-mot-khach-api-goi-10k-req-s/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Reliable Webhooks (signature, retry, idempotent receiver) — Gửi webhook cho đối tác, họ down 5 phút là mất sự kiện](./13-backend-transporter/04-webhook-delivery-doi-tac-down-5-phut-mat-su-kien/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Asynchronous Request-Reply — Xử lý mất 30 giây, HTTP timeout ở 10 giây](./13-backend-transporter/05-async-request-reply-xu-ly-30-giay-http-timeout/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Broker-based RPC (NATS request-reply, Moleculer transporter) — Service gọi nhau qua broker thay vì HTTP trực tiếp: khi nào đáng?](./13-backend-transporter/06-nats-request-reply-moleculer-transporter-service-goi-nhau-qua-broker/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Service Mesh (sidecar) — mTLS, retry, tracing cho 40 service mà không sửa code từng service](./13-backend-transporter/07-service-mesh-mtls-retry-tracing-khong-sua-code/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 14 · Hàng đợi và message queue (`backend / queueing / message queueing`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Work Queue / Competing Consumers — Gửi 100k email marketing làm treo API đặt hàng](./14-backend-queueing/01-work-queue-gui-100k-email-lam-treo-api/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Choosing a Broker — Team 5 người: Redis Streams, RabbitMQ, Kafka, NATS JetStream hay queue trong Postgres (PGMQ)?](./14-backend-queueing/02-chon-broker-redis-rabbitmq-kafka-nats-pgmq-team-5-nguoi/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Transactional Outbox — Ghi đơn hàng xong, crash trước khi publish → event mất, kho không trừ](./14-backend-queueing/03-transactional-outbox-ghi-don-xong-crash-mat-event/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Idempotent Consumer — Event tới hai lần (at-least-once), kho bị trừ hai lần](./14-backend-queueing/04-idempotent-consumer-event-den-hai-lan-tru-kho-hai-lan/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Dead Letter Queue & Poison Message — Một message lỗi retry vô hạn, chặn cả hàng đợi](./14-backend-queueing/05-dead-letter-queue-mot-message-loi-chan-ca-hang-doi/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Message Ordering (partition key) — "Đã giao" tới trước "Đang giao", trạng thái đơn nhảy ngược](./14-backend-queueing/06-ordering-partition-key-trang-thai-don-den-sai-thu-tu/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Delayed / Scheduled Messages — Hủy đơn chưa thanh toán sau 15 phút cho 1 triệu đơn/ngày](./14-backend-queueing/07-delayed-message-huy-don-chua-thanh-toan-sau-15-phut/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Claim Check — Message chứa file PDF 50 MB làm nghẽn broker](./14-backend-queueing/08-claim-check-message-50mb-lam-nghen-broker/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Backpressure & Consumer Autoscaling (lag-based) — Hàng đợi dồn 500k message tối flash sale, sáng mới xử lý xong](./14-backend-queueing/09-consumer-lag-autoscale-hang-doi-dong-500k-message-toi-flash-sale/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 15 · Lưu trữ file và object (`backend / storage`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Object Storage vs DB / Local Disk — File đính kèm lưu trong DB làm backup 200 GB; lưu trên disk server thì scale ngang mất file](./15-backend-storage/01-object-storage-vs-luu-file-trong-db-hoac-disk-server/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Presigned URL (Valet Key) — Upload file 500 MB đi qua API server làm nghẽn toàn bộ API](./15-backend-storage/02-presigned-url-valet-key-upload-500mb-qua-api-lam-nghen/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Multipart & Resumable Upload — Upload video 2 GB đứt mạng ở 90% phải làm lại từ đầu](./15-backend-storage/03-multipart-resumable-upload-video-dut-mang-lam-lai-tu-dau/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Async Media Processing Pipeline — Mỗi ảnh sản phẩm cần 6 kích cỡ và WebP, xử lý đồng bộ làm upload chậm 8 giây](./15-backend-storage/04-image-pipeline-mot-anh-can-6-kich-co/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Private Content via Signed CDN URLs — Link hợp đồng riêng tư bị share ra ngoài vẫn mở được](./15-backend-storage/05-signed-cdn-url-hop-dong-rieng-tu-bi-share-link/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Lifecycle Policies & Storage Tiers — Chi phí lưu trữ tăng gấp 3 vì giữ mọi file ở hot tier](./15-backend-storage/06-lifecycle-tiering-chi-phi-luu-tru-tang-gap-3/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Backup & Point-in-Time Recovery (3-2-1) — Xóa nhầm bảng lúc 14h, bản backup gần nhất là 2h sáng](./15-backend-storage/07-backup-pitr-xoa-nham-bang-luc-14h-backup-dem-qua/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Upload Hardening (validation, content sniffing, AV scan) — Khách upload "ảnh.jpg" thực ra là file HTML chứa script](./15-backend-storage/08-upload-security-virus-scan-content-type-sniffing/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |

### 16 · Kubernetes (`backend / k8s`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Health Probes & Rolling Update — Pod mới nhận traffic khi chưa kết nối DB xong, lỗi 502 mỗi lần deploy](./16-backend-k8s/01-probes-rolling-update-deploy-moi-nhan-traffic-khi-chua-san-sang/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Graceful Shutdown (SIGTERM, preStop, terminationGracePeriod) — Mỗi lần deploy rớt vài chục request đang xử lý](./16-backend-k8s/02-graceful-shutdown-prestop-deploy-lam-rot-request-dang-xu-ly/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Resource Requests/Limits & HPA — 9h sáng traffic gấp 5, pod OOMKilled hoặc node hết chỗ](./16-backend-k8s/03-requests-limits-hpa-9h-sang-traffic-gap-5/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [ConfigMap, Secret & External Secrets — Password DB nằm trong YAML commit lên Git](./16-backend-k8s/04-config-secret-external-secrets-password-db-nam-trong-yaml/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Ingress & Automated TLS — Chứng chỉ hết hạn lúc nửa đêm, cả hệ thống báo đỏ](./16-backend-k8s/05-ingress-tls-cert-manager-chung-chi-het-han-luc-nua-dem/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Canary / Blue-Green (Argo Rollouts) — Release có bug ảnh hưởng 100% người dùng ngay lập tức](./16-backend-k8s/06-canary-blue-green-argo-rollouts-release-loi-anh-huong-100-phan-tram/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [PodDisruptionBudget & Anti-affinity — Nâng cấp node làm 3 replica cùng chết vì nằm chung một node](./16-backend-k8s/07-pdb-anti-affinity-node-drain-lam-down-ca-service/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [GitOps (Argo CD) — Không ai biết production đang chạy version nào, ai deploy lúc nào](./16-backend-k8s/08-gitops-argocd-ai-deploy-gi-luc-nao-khong-ro/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Event-driven Autoscaling (KEDA) — Worker chạy 10 pod cả đêm dù hàng đợi trống](./16-backend-k8s/09-keda-scale-worker-theo-do-dai-hang-doi/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 17 · Docker (`backend / docker`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Multi-stage Build — Image 1,8 GB chứa cả devDependencies, deploy mất 10 phút](./17-backend-docker/01-multi-stage-build-image-1-8gb-deploy-10-phut/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Layer Caching & .dockerignore — Mỗi build cài lại toàn bộ npm 5 phút dù chỉ sửa một dòng code](./17-backend-docker/02-layer-cache-dockerignore-moi-build-cai-lai-npm-5-phut/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [PID 1 & Signal Handling — Container không nhận SIGTERM, bị kill cứng sau 10 giây, request rớt](./17-backend-docker/03-pid-1-signal-sigterm-container-khong-tat-sach/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Non-root, Read-only FS & Distroless — Container chạy root, có shell; một lỗ RCE là chiếm được node](./17-backend-docker/04-non-root-distroless-container-chay-root-co-shell/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Docker Compose & Dev/Prod Parity — "Trên máy em chạy được" vì Postgres local 14, production 16](./17-backend-docker/05-compose-dev-prod-parity-tren-may-em-chay-duoc/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [HEALTHCHECK & Startup Ordering — App khởi động trước khi DB sẵn sàng, crash loop](./17-backend-docker/06-healthcheck-depends-on-app-khoi-dong-truoc-db-san-sang/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Image Tagging, SBOM & Vulnerability Scan — Tag `latest` không biết đang chạy version nào, không biết có CVE không](./17-backend-docker/07-image-tagging-sbom-scan-tag-latest-khong-biet-dang-chay-gi/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Runtime Config & Secrets — API key nằm trong layer image, ai pull cũng đọc được](./17-backend-docker/08-env-config-secrets-khong-nuong-vao-image/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |

### 18 · Mở rộng dọc và ngang (`backend / vertical / horizontal scale`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Stateless Service & Externalized Session — Login ở server A, request sau vào server B bị văng ra](./18-backend-scale/01-stateless-session-externalized-login-server-a-server-b-khong-biet/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Vertical first, then Horizontal — DB CPU 90%: nâng máy hay thêm máy? Thang scale theo thứ tự](./18-backend-scale/02-scale-up-truoc-hay-scale-out-db-cpu-90/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Load Balancing Algorithms — Một server quá tải trong khi 3 server khác rảnh vì round-robin với request không đều](./18-backend-scale/03-load-balancing-mot-server-qua-tai-cac-server-khac-ranh/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Queue-Based Load Leveling — Đỉnh 20h gấp 20 lần bình thường trong 10 phút, mua máy cho đỉnh thì lãng phí](./18-backend-scale/04-queue-based-load-leveling-dinh-20h-flash-sale/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Load Shedding & Graceful Degradation — Quá tải thì từ chối 20% request thay vì sập 100%](./18-backend-scale/05-load-shedding-qua-tai-thi-tu-choi-mot-phan-thay-vi-sap-het/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Sharding with Consistent Hashing — Dữ liệu vượt một máy; chia theo khách hàng mà thêm máy không phải chia lại hết](./18-backend-scale/06-sharding-consistent-hashing-mot-db-khong-chua-noi-du-lieu/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Capacity Planning (USE method, Little's law) — Mua bao nhiêu máy cho mùa Tết? Hiện tại đoán mò](./18-backend-scale/07-capacity-planning-use-method-mua-may-bao-nhieu-cho-tet/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Autoscaling Policies (target tracking, predictive, cooldown) — Autoscale phản ứng sau 5 phút, traffic đến trong 1 phút](./18-backend-scale/08-autoscaling-policy-scale-cham-hon-traffic/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |

### 19 · Xác thực và phân quyền (`backend / frontend / authenticate`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Password Hashing (Argon2id / bcrypt) — Lộ DB là lộ toàn bộ mật khẩu vì lưu MD5](./19-backend-frontend-authenticate/01-password-hashing-argon2-lo-db-la-lo-mat-khau/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-09 |
| [Session Cookie vs JWT — SPA + API: lưu token ở localStorage (XSS) hay cookie (CSRF)?](./19-backend-frontend-authenticate/02-session-cookie-vs-jwt-spa-luu-token-o-dau/) | 🟢 Cơ bản | ✅ Hoàn thành | 2026-10-09 |
| [OAuth 2.0 Authorization Code + PKCE — Đăng nhập bằng Google/Zalo cho SPA và app mobile không có nơi giữ secret](./19-backend-frontend-authenticate/03-oauth2-pkce-dang-nhap-google-cho-spa-va-mobile/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Refresh Token Rotation & Reuse Detection — Refresh token bị đánh cắp dùng được mãi](./19-backend-frontend-authenticate/04-refresh-token-rotation-token-bi-danh-cap-dung-mai/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [BFF / Token Handler for SPA — Token không bao giờ chạm JavaScript trên trình duyệt](./19-backend-frontend-authenticate/05-bff-token-handler-token-khong-bao-gio-cham-trinh-duyet/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [RBAC → ABAC → ReBAC — Phân quyền "quản lý chi nhánh chỉ xem hợp đồng chi nhánh mình" vượt khả năng của role](./19-backend-frontend-authenticate/06-rbac-abac-rebac-phan-quyen-theo-chi-nhanh-phong-ban/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [SSO with OpenID Connect — 5 ứng dụng nội bộ, 5 lần đăng nhập, 5 nơi quản lý user](./19-backend-frontend-authenticate/07-sso-oidc-mot-lan-dang-nhap-cho-5-ung-dung-noi-bo/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [MFA: TOTP & Passkeys (WebAuthn) — Tài khoản kế toán bị chiếm vì mật khẩu lộ từ web khác](./19-backend-frontend-authenticate/08-mfa-totp-webauthn-passkey-tai-khoan-ke-toan-bi-chiem/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Multi-tenant Authorization — Người của công ty A gọi API với id của công ty B và lấy được dữ liệu](./19-backend-frontend-authenticate/09-multi-tenant-auth-tenant-trong-token-va-cach-ly/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Machine-to-Machine Auth (API keys, client credentials, mTLS) — Cron job và đối tác gọi API: dùng API key hay OAuth client credentials?](./19-backend-frontend-authenticate/10-api-key-service-to-service-client-credentials-mtls/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |

### 20 · Thiết kế hệ thống AI framework, cơ bản → nâng cao (`backend / AI framework system design`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Model Gateway / Provider Abstraction — Đổi model hoặc nhà cung cấp phải sửa 30 file](./20-backend-ai-framework-system-design/01-llm-gateway-abstraction-doi-model-phai-sua-30-file/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Prompt as Code (template, version, test) — Prompt nằm rải rác trong string literal, sửa không biết hỏng gì](./20-backend-ai-framework-system-design/02-prompt-as-code-prompt-nam-rai-trong-string-khong-version/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Structured Output (JSON schema / strict tools) — Parse JSON từ text trả về fail 5% request](./20-backend-ai-framework-system-design/03-structured-output-parse-json-tu-text-fail-5-phan-tram/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Workflow Patterns (chaining, routing, parallelization, evaluator-optimizer) — Pipeline xử lý hồ sơ bảo hiểm 6 bước, bước nào cũng có thể sai](./20-backend-ai-framework-system-design/04-workflow-patterns-chaining-routing-parallelization/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Resilience for LLM Calls (retry, fallback model, circuit breaker) — API trả 429/529 lúc cao điểm, tính năng chết](./20-backend-ai-framework-system-design/05-fallback-retry-circuit-breaker-cho-llm-api-429-529/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Eval Pipeline & LLM-as-Judge in CI — Sửa prompt không biết tốt hơn hay tệ hơn](./20-backend-ai-framework-system-design/06-llm-as-judge-eval-pipeline-trong-ci-sua-prompt-khong-biet-tot-hon-hay-te-hon/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Context Engineering (compaction, context editing, just-in-time retrieval) — Hội thoại dài 20 lượt tràn context, chất lượng tụt](./20-backend-ai-framework-system-design/07-context-engineering-context-window-tran-sau-20-luot/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Durable Execution for Long AI Workflows — Workflow AI chạy 10 phút, crash giữa chừng là làm lại từ đầu, tốn tiền gấp đôi](./20-backend-ai-framework-system-design/08-durable-execution-workflow-ai-chay-10-phut-crash-giua-chung/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Tool Design & Tool Search — 30 tool trong một agent, agent chọn sai tool 15% số lần](./20-backend-ai-framework-system-design/09-tool-design-for-agents-30-tool-agent-chon-sai/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Guardrails Layer (input / output validation) — Model trả lời câu hỏi ngoài phạm vi: tư vấn y tế trong app bán hàng](./20-backend-ai-framework-system-design/10-guardrails-layer-input-output-validation-model-tra-loi-ngoai-pham-vi/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |

### 21 · Hạ tầng AI (`backend / AI infrastructure`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [API vs Self-hosting LLM — Dữ liệu nhạy cảm: gọi API hay tự host mô hình mở? Bài toán chi phí và tuân thủ](./21-backend-ai-infrastructure/01-api-vs-self-host-du-lieu-nhay-cam-co-nen-tu-host-model/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [LLM Gateway (key management, quota, cost per team) — 5 team dùng chung một API key, hóa đơn tăng không biết ai tốn](./21-backend-ai-infrastructure/02-llm-gateway-5-team-chung-mot-api-key-khong-biet-ai-ton-tien/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Model Serving (vLLM, continuous batching, PagedAttention) — Tự host mô hình 8B phục vụ 50 req/s trên 1 GPU](./21-backend-ai-infrastructure/03-vllm-serving-continuous-batching-tu-host-50-req-s/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [GPU Scheduling on Kubernetes (device plugin, MIG, time-slicing) — GPU A100 rảnh 70% thời gian nhưng không chia được cho 3 service](./21-backend-ai-infrastructure/04-gpu-on-k8s-device-plugin-mig-time-slicing-gpu-ranh-70-phan-tram/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Embedding Ingestion Pipeline (batch, idempotent, resumable) — Nhập 10 triệu tài liệu, chạy lại từ đầu mỗi lần lỗi](./21-backend-ai-infrastructure/05-embedding-pipeline-nhap-10-trieu-tai-lieu-idempotent/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Scale-to-zero & Spot GPUs — GPU chạy cả đêm tốn tiền dù không ai dùng](./21-backend-ai-infrastructure/06-scale-to-zero-gpu-spot-gpu-chay-ca-dem-khong-ai-dung/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Prefix / KV Caching at Serving Layer — System prompt 5k token được tính lại cho mỗi request](./21-backend-ai-infrastructure/07-inference-cache-kv-prefix-caching-system-prompt-5k-token-moi-request/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Multi-provider / Multi-region Failover — Provider gặp sự cố 2 giờ, toàn bộ tính năng AI chết](./21-backend-ai-infrastructure/08-multi-region-failover-llm-provider-mot-region-down/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |

### 22 · Tối ưu AI: chi phí, độ trễ, chất lượng (`backend / AI optimizer`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Prompt Caching — System prompt và tài liệu 20k token trả tiền đầy đủ cho mọi request](./22-backend-ai-optimizer/01-prompt-caching-system-prompt-20k-token-tra-tien-moi-request/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Batch Processing (Message Batches) — Phân loại 1 triệu ticket cũ, không cần realtime nhưng đang trả giá realtime](./22-backend-ai-optimizer/02-batch-api-phan-loai-1-trieu-ticket-cu/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Model Routing / Cascade — 80% câu hỏi đơn giản nhưng gửi hết vào model đắt nhất](./22-backend-ai-optimizer/03-model-routing-cascade-80-phan-tram-cau-don-gian-vao-model-dat/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Effort / Thinking Tuning — Trả tiền "suy nghĩ sâu" cho câu hỏi "giờ mở cửa?"](./22-backend-ai-optimizer/04-effort-thinking-tuning-tra-tien-suy-nghi-cho-cau-hoi-don-gian/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Semantic Cache — 10% câu hỏi lặp lại gần nguyên văn vẫn gọi model](./22-backend-ai-optimizer/05-semantic-cache-10-phan-tram-cau-hoi-lap-lai-nguyen-van/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Context Pruning & Summarization — Gửi lại 100 lượt hội thoại mỗi request, chi phí tăng tuyến tính](./22-backend-ai-optimizer/06-context-pruning-lich-su-hoi-thoai-100-luot-gui-lai-moi-lan/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Streaming for Perceived Latency — Khách nhìn màn hình trắng 8 giây chờ câu trả lời dài](./22-backend-ai-optimizer/07-streaming-ttft-khach-nhin-man-hinh-trang-8-giay/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Distillation to a Small Model — Phân loại 50 nhãn chạy 2 triệu lần/ngày trên model lớn](./22-backend-ai-optimizer/08-distillation-fine-tune-model-nho-phan-loai-50-nhan/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Quantization & Speculative Decoding (self-host) — Mô hình tự host chậm 20 token/s và tốn 80 GB VRAM](./22-backend-ai-optimizer/09-quantization-speculative-decoding-self-host-cham-va-ton-vram/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Output Token Discipline — Model trả lời dài gấp 3 cần thiết; token đầu ra đắt gấp 5 lần token đầu vào](./22-backend-ai-optimizer/10-token-budget-output-limits-model-tra-loi-dai-gap-3-can-thiet/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |

### 23 · Giám sát và benchmark (`backend / monitoring benchmark`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [Four Golden Signals / RED / USE — Khách than chậm, không biết service nào chậm](./23-backend-monitoring-benchmark/01-four-golden-signals-red-method-khong-biet-service-nao-cham/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Structured Logging & Correlation ID — Grep log của 6 service để tìm một request của khách](./23-backend-monitoring-benchmark/02-structured-logging-correlation-id-grep-log-6-service-tim-mot-request/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Distributed Tracing (OpenTelemetry) — Request đi qua 6 service, chậm ở đâu?](./23-backend-monitoring-benchmark/03-distributed-tracing-otel-request-qua-6-service-cham-o-dau/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Percentiles & Histograms — Trung bình 200 ms nhưng khách than chậm: p99 là 4 giây](./23-backend-monitoring-benchmark/04-percentiles-p99-trung-binh-200ms-nhung-khach-than-cham/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [SLI / SLO / Error Budget — "Hệ thống ổn chưa?" không ai trả lời được bằng số](./23-backend-monitoring-benchmark/05-slo-error-budget-he-thong-on-chua-khong-co-so/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Alerting on Symptoms (alert fatigue) — 50 alert mỗi đêm, không ai đọc nữa](./23-backend-monitoring-benchmark/06-alerting-symptom-not-cause-50-alert-moi-dem-khong-ai-doc/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Load Testing Methodology (k6, coordinated omission) — Benchmark nói chịu được 5k RPS, production sập ở 2k](./23-backend-monitoring-benchmark/07-load-testing-k6-coordinated-omission-benchmark-tu-danh-lua/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Continuous Profiling — CPU 80% nhưng không biết hàm nào ăn](./23-backend-monitoring-benchmark/08-continuous-profiling-cpu-80-phan-tram-khong-biet-ham-nao/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Synthetic Monitoring & Health Endpoints — Khách báo lỗi trước khi đội kỹ thuật biết](./23-backend-monitoring-benchmark/09-synthetic-monitoring-health-check-khach-bao-loi-truoc-khi-doi-ky-thuat-biet/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |

### 24 · Giám sát AI (`backend / AI monitoring`)

| Bài | Mức | Trạng thái | Cập nhật |
|---|---|---|---|
| [LLM Tracing (prompt / completion / tool spans) — Chatbot trả lời sai, không biết prompt, context, tool nào gây ra](./24-backend-ai-monitoring/01-llm-tracing-chatbot-tra-loi-sai-khong-biet-prompt-nao/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Token & Cost Attribution — Hóa đơn tăng 3 lần, không biết tính năng nào hay tenant nào gây ra](./24-backend-ai-monitoring/02-token-cost-per-feature-tenant-hoa-don-tang-3-lan-khong-biet-vi-sao/) | 🟢 Cơ bản | 📋 Kế hoạch | 2026-10-06 |
| [Online Quality Monitoring (sampled LLM-as-judge + user feedback) — Chất lượng tụt dần sau khi đổi model, 2 tuần sau mới biết](./24-backend-ai-monitoring/03-quality-monitoring-llm-judge-sampling-chat-luong-tut-dan-khong-ai-thay/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Golden Dataset from Production Traces — Mỗi lần sửa prompt không có bộ test hồi quy](./24-backend-ai-monitoring/04-golden-dataset-tu-production-regression-test-prompt/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Retrieval Quality Monitoring (hit rate, MRR, context precision) — Tài liệu mới thêm không bao giờ được tìm thấy](./24-backend-ai-monitoring/05-rag-retrieval-metrics-hit-rate-mrr-tai-lieu-moi-khong-duoc-tim-thay/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Safety & Guardrail Metrics — Không biết có bao nhiêu lần bị thử prompt injection mỗi ngày](./24-backend-ai-monitoring/06-guardrail-metrics-injection-attempts-refusal-rate/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [LLM Latency Breakdown (TTFT, tokens/s, end-to-end) — Chat "cảm giác chậm" nhưng p50 end-to-end bình thường](./24-backend-ai-monitoring/07-latency-ttft-tokens-per-second-chat-cham-nhung-p50-binh-thuong/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
| [Input Drift Detection — Sau chiến dịch marketing, 40% câu hỏi thuộc chủ đề chưa từng có trong eval](./24-backend-ai-monitoring/08-drift-detection-phan-phoi-cau-hoi-doi-sau-chien-dich-marketing/) | 🔴 Nâng cao | 📋 Kế hoạch | 2026-10-06 |
| [Feedback Loop (thumbs → triage → eval case) — 2.000 lượt "không hữu ích" mỗi tuần không ai đọc](./24-backend-ai-monitoring/09-feedback-loop-thumbs-down-thanh-eval-case/) | 🟡 Trung bình | 📋 Kế hoạch | 2026-10-06 |
