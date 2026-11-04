# Bulkhead — Một khách hàng lớn chiếm hết pool kết nối, mọi khách khác bị lỗi theo

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 07 · backend / microservices | 🔴 Nâng cao | ✅ Hoàn thành | Bulkhead — Nygard, *Release It!* (2007/2018); Azure "Bulkhead" | 2026-11-04 |

> **Một câu tóm tắt:** Chia tài nguyên dùng chung (pool kết nối database, số request đồng thời, worker, nhóm instance) thành các khoang riêng theo loại tải và theo tenant, để một khách lớn chạy báo cáo nặng chỉ làm đầy khoang của chính nó — các khách khác vẫn được phục vụ bình thường.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
SaaS B2B bán phần mềm CRM cho 300 công ty, tất cả dùng chung cụm `crm-api` gồm 6 instance Node.js; mỗi instance có một pool 20 kết nối PostgreSQL. Một khách doanh nghiệp lớn (khoảng 35 % dữ liệu toàn hệ thống) có tích hợp gọi API xuất danh bạ và báo cáo pipeline vào đầu giờ sáng.

**Triệu chứng người kinh doanh nhìn thấy**
- 8–9 giờ sáng thứ Hai, mọi khách báo "CRM quay mãi, không lưu được ghi chú" trong khoảng 20 phút; đội hỗ trợ nhận hàng trăm ticket.
- Chỉ một khách đang xuất dữ liệu lớn nhưng 299 khách còn lại chịu lỗi; khách nhỏ dọa hủy hợp đồng vì "trả tiền mà không dùng được".
- Tăng pool lên 50 kết nối thì PostgreSQL chạm `max_connections` và chậm toàn bộ.

**Nguyên nhân kỹ thuật**
Mọi loại tải (thao tác ngắn, báo cáo dài, xuất dữ liệu) và mọi tenant dùng chung một pool. Mỗi truy vấn báo cáo của khách lớn giữ kết nối 20–40 giây; khi 20 truy vấn như vậy chạy cùng lúc trên một instance, pool cạn, request ngắn của khách khác xếp hàng chờ kết nối rồi timeout. Node.js đơn luồng nên "thread pool" ở đây chính là pool kết nối và số request đồng thời — tài nguyên hữu hạn dùng chung không có vách ngăn biến tải của một khách thành sự cố của tất cả (*noisy neighbor*).

**Ràng buộc**
- Không dựng hạ tầng riêng cho từng khách vì chi phí; được phép có khoang riêng cho nhóm khách lớn.
- Khách lớn vẫn phải xuất được dữ liệu, chấp nhận chậm hơn hoặc xếp hàng.
- Tổng kết nối tới PostgreSQL không vượt ngưỡng an toàn (ví dụ 200); thao tác tương tác p99 ≤ 500 ms kể cả khi có báo cáo lớn (minh họa).

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** tài nguyên hữu hạn được dùng chung mà không có vách ngăn giữa các nhóm tải, nên nhóm tiêu thụ nhiều nhất quyết định trải nghiệm của mọi nhóm khác.

**Pattern giải quyết thế nào:** Nygard mượn hình ảnh vách ngăn khoang tàu: thủng một khoang, tàu không chìm. Azure mô tả Bulkhead là phân vùng instance và tài nguyên (pool kết nối, tiến trình, hàng đợi) thành các nhóm theo tải và yêu cầu khả dụng của người dùng. Bài áp dụng ba lớp. (1) Theo *loại tải*: pool riêng cho thao tác tương tác và cho báo cáo; truy vấn dài không chạm kết nối của request ngắn. (2) Theo *tenant*: giới hạn số request đồng thời của mỗi tenant trong mỗi khoang, có hàng chờ ngắn; vượt thì trả 429 kèm `Retry-After` — chỉ tenant gây quá tải bị ảnh hưởng. (3) Theo *hạng khách*: tenant lớn có thể được định tuyến sang nhóm instance riêng khi hai lớp trên chưa đủ. Xuất dữ liệu chuyển sang worker qua hàng đợi với concurrency cố định. Khác với rate limiting (giới hạn số request trong một khoảng thời gian), bulkhead giới hạn số request *đang chiếm* tài nguyên cùng lúc.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (tăng pool, thêm index cho báo cáo) | Đỡ được một thời gian | PostgreSQL chạm `max_connections`; báo cáo nặng hơn là lặp lại; không có giới hạn theo tenant |
| Rate limiting theo API key | Chặn số request mỗi giây | Báo cáo gửi ít request nhưng mỗi request giữ kết nối 30 giây; tốc độ thấp vẫn cạn pool |
| Read replica cho báo cáo | Tách tải đọc khỏi primary | Bổ trợ tốt nhưng tranh chấp pool trong ứng dụng và giữa tenant trên replica vẫn còn |
| Hạ tầng riêng cho mỗi tenant | Cách ly tuyệt đối | Chi phí nhân 300 lần, vận hành nặng |
| Bulkhead: pool theo loại tải + giới hạn đồng thời theo tenant + nhóm instance cho khách lớn (chọn) | Sự cố bị nhốt trong khoang của tenant gây ra | Thêm tham số phải chỉnh; dung lượng chia nhỏ có thể bị bỏ phí lúc thấp tải |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước"]
    direction LR
    T1["300 tenant<br/>tương tác + báo cáo + xuất"]:::cu
    A1["crm-api<br/>một pool 20 kết nối"]:::loi
    D1["PostgreSQL"]:::cu
    T1 --> A1 --> D1
  end

  subgraph SAU["Sau"]
    direction LR
    T2["300 tenant"]:::cu
    CL["Bộ phân loại<br/>theo route và tenant"]:::moi
    KI["Khoang tương tác<br/>pool 14, tối đa 4 đồng thời mỗi tenant"]:::moi
    KR["Khoang báo cáo<br/>pool 4, tối đa 1 đồng thời mỗi tenant"]:::moi
    Q["PGMQ + export worker<br/>concurrency 2"]:::moi
    D2["PostgreSQL"]:::cu
    T2 --> CL
    CL --> KI --> D2
    CL --> KR --> D2
    CL -->|"xuất dữ liệu"| Q --> D2
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  participant BIG as Khách lớn
  participant SM as Khách nhỏ
  participant API as crm-api
  participant KR as Khoang báo cáo
  participant KI as Khoang tương tác
  participant DB as PostgreSQL
  BIG->>API: 30 request báo cáo cùng lúc
  API->>KR: Xin chỗ cho BIG, tối đa 1 đồng thời, hàng chờ 3
  KR->>DB: 1 truy vấn báo cáo 30 giây
  KR-->>API: 3 request vào hàng chờ, 26 bị từ chối
  API-->>BIG: 429 kèm Retry-After cho 26 request
  SM->>API: Lưu ghi chú
  API->>KI: Xin chỗ cho tenant SM
  KI->>DB: INSERT bằng kết nối của pool tương tác
  DB-->>KI: Xong trong 15 ms
  API-->>SM: 200 trong 40 ms
  Note over API,DB: Khoang báo cáo đầy không chạm tới pool tương tác
```

### 3.3 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| Bộ phân loại request | Gắn request vào khoang theo route và tenant | Tenant lấy từ token đã xác thực, không tin header client gửi |
| Pool kết nối theo khoang | `pg.Pool` riêng cho tương tác và báo cáo | Tổng kích thước pool × số instance tối đa ≤ ngưỡng an toàn của PostgreSQL |
| Giới hạn đồng thời theo tenant | Semaphore theo cặp (khoang, tenant) với hàng chờ ngắn | Hàng chờ có giới hạn và timeout; đầy thì 429 kèm `Retry-After` |
| `statement_timeout` theo khoang | Chặn truy vấn chạy quá lâu giữ kết nối | Tương tác 2 giây, báo cáo 60 giây; đặt theo role database hoặc theo kết nối |
| Export worker | Xử lý xuất dữ liệu qua PGMQ với concurrency cố định | Việc dài ra khỏi request; khách nhận file khi xong |
| Nhóm instance cho khách lớn | Deployment riêng nhận tenant hạng enterprise, định tuyến ở gateway | Chỉ làm khi hai lớp trên chưa đủ |

### 3.4 Điểm dễ sai khi triển khai
- **Tổng pool vượt `max_connections` khi autoscale.** 6 instance × 18 kết nối là 108; scale lên 12 instance thành 216. Tính theo số instance tối đa; cân nhắc PgBouncer.
- **Hàng chờ không giới hạn.** Khoang không bao giờ "đầy" mà chỉ chậm dần và tốn bộ nhớ; hàng chờ phải có kích thước và thời gian chờ tối đa.
- **Giới hạn tenant đếm ở từng instance.** 6 instance × 1 = 6 truy vấn báo cáo đồng thời thực tế; chấp nhận và tính vào kích thước pool, hoặc dùng bộ đếm phân tán trên Redis với chi phí độ trễ.
- **Quên trả chỗ khi lỗi hoặc timeout.** Khoang rò rỉ dần tới đầy; bọc bằng `try/finally` và viết test cho đường lỗi.
- **Client hủy nhưng truy vấn vẫn chạy.** Kết nối bị giữ dù không ai chờ kết quả; cần `statement_timeout` và hủy truy vấn khi client ngắt.
- **Chia khoang trước khi đo.** Khoang quá nhỏ gây từ chối oan và lãng phí lúc thấp tải; lấy số từ `pg_stat_activity` và metrics trước khi chốt.
- **Tin rằng thư viện có hạn chờ trong hàng.** Bulkhead của `cockatiel` chỉ kiểm `signal` lúc lấy việc ra khỏi hàng, nên request hết hạn vẫn nằm đó tới khi có chỗ. Lab tự viết semaphore có hẹn giờ cho từng request.
- **Test bulkhead mà không có tranh chấp thật.** Bản đầu có 3 test xanh giả, phép thử âm mới lộ ra: chỉ một tenant chạy báo cáo thì giới hạn theo tenant đã che mất việc tách pool; gọi tenant khác sau khi tenant đầu xong thì không có gì để tranh; và "từ chối" sau 50 ms không phân biệt được với "từ chối ngay".

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ứng dụng | TypeScript strict, NestJS (`crm-api`) | Guard và interceptor gắn khoang theo route | Fastify |
| Pool kết nối | `pg` (node-postgres), một `Pool` cho mỗi khoang | Pool là đơn vị cách ly rõ nhất, cấu hình kích thước và timeout riêng | PgBouncer với pool theo user hoặc database |
| Giới hạn đồng thời | Bulkhead policy của `cockatiel` (giới hạn thực thi + hàng chờ) | Có sẵn hàng chờ giới hạn và lỗi rõ khi đầy | `p-limit` + hàng chờ tự viết; semaphore trên Redis cho giới hạn toàn cụm |
| Việc dài | PGMQ + export worker | Xuất dữ liệu ra khỏi request, concurrency cố định | BullMQ |
| Database | PostgreSQL 16 | `statement_timeout`, `max_connections`, `pg_stat_activity` để quan sát | — |
| Tải | k6 hai kịch bản song song: khách lớn bắn báo cáo, 50 khách nhỏ thao tác ngắn | Tái hiện noisy neighbor có kiểm soát | Gatling |
| Đo, hạ tầng | Prometheus + `prom-client`; Docker Compose | Gauge chỗ đang dùng và hàng chờ, counter từ chối theo tenant; cảnh báo theo khoang, không chỉ theo tổng | Grafana để vẽ |

**Thay đổi so với hệ thống hiện tại:** `crm-api` có hai pool và lớp giới hạn đồng thời theo tenant; xuất dữ liệu thành tác vụ nền trả file sau; khách lớn có thể nhận 429 nên tài liệu API và hợp đồng phải ghi rõ giới hạn. Đội vận hành theo dõi metrics theo khoang và học cách chỉnh kích thước khoang từ số đo.

**Ghi chú khi làm lab**
- Phiên bản: NestJS 10.4.22, `pg` 8.23.1, `prom-client` 15.1.3, `ghcr.io/pgmq/pg16-pgmq:v1.13.0` (PostgreSQL 16.15, PGMQ 1.13.0), Prometheus 3.14.0, k6 1.4.2.
- Không dùng `cockatiel`: hàng chờ của nó không hết hạn đúng lúc (mục 3.4). Dùng semaphore tự viết, phương án thay thế đã nêu trong bảng.
- Hai bản có **cùng tổng 20 kết nối**: bản trước một pool 20, bản sau 14 + 4 + 2. Khác biệt đo được đến từ cách chia, không phải từ việc có thêm tài nguyên.
- Một instance `crm-api` thay vì 6, nên bộ đếm theo tenant không có vấn đề đếm ở từng instance. Bước thử tăng số instance ở mục 8 không làm.
- Báo cáo chậm có chủ đích bằng `pg_sleep`, 5 giây thay vì 20 – 40 giây của mục 1, và lượt đo 3 phút thay vì 10 phút, để lượt đo gọn.
- Tenant đọc từ header `x-tenant-id`, coi như gateway đã xác thực. Chưa làm: nhóm instance cho khách lớn, PgBouncer, hủy truy vấn khi client ngắt.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| p99 thao tác tương tác của khách nhỏ khi khách lớn chạy báo cáo | 30.000 ms (timeout) | ≤ 500 ms | k6 hai kịch bản song song, histogram theo khoang |
| Tỷ lệ lỗi của khách nhỏ trong lúc đó | 40 % | ≤ 0,1 % | k6 `checks` theo mã trả về của kịch bản khách nhỏ |
| Số kết nối PostgreSQL cao nhất | chạm `max_connections` | ≤ ngưỡng đặt (ví dụ 200) | Lấy mẫu `pg_stat_activity` mỗi giây |
| Báo cáo của khách lớn hoàn tất | treo, bị hủy | 100 % hoàn tất (xếp hàng và retry theo `Retry-After`) | Đếm kết quả báo cáo ở kịch bản khách lớn |
| Thời gian chờ chỗ trong khoang tương tác | — | p99 ≤ 20 ms | Histogram thời gian chờ semaphore |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** một khách dùng nặng không còn làm 299 khách khác mất khả năng làm việc; khách lớn vẫn có dữ liệu, chỉ chậm hơn và được báo trước bằng giới hạn rõ ràng.

### 5.1 Số đã đo

**Môi trường** (đo ngày 2026-11-04): Apple M5, 10 nhân, 32 GB RAM, macOS (Darwin 25.6.0), cắm sạc, mở nắp, không có khoảng ngủ ở cả bốn lượt. Docker Desktop 29.9.2, Compose v5.6.1, máy ảo Docker 10 CPU và 7,75 GiB RAM. PostgreSQL 16.15, PGMQ 1.13.0, service trên `node:20-alpine` (Node 20.20.2), k6 1.4.2 cùng mạng Compose. Load 1 phút của macOS: 3,6 – 4,6.

**Tải:** 300 tenant, T-1 chiếm 35 % dữ liệu. 50 khách nhỏ ghi chú tổng cộng 50 request/giây; khách lớn giữ 30 báo cáo liên tục, mỗi báo cáo 5 giây, cộng 12 lần xuất dữ liệu mỗi phút. Mỗi kịch bản 3 phút. Hai lượt mỗi bản, đảo thứ tự. Không rớt iteration nào.

| Chỉ số | Trước (`main`, `round-2`) | Sau (`main`, `round-2`) | Mục tiêu | Kết luận |
|---|---|---|---|---|
| p99 ghi chú của khách nhỏ khi khách lớn chạy báo cáo | 5.018,3 ms, 5.018,9 ms | 6,1 ms, 8,2 ms | ≤ 500 ms | Đạt |
| Tỷ lệ lỗi của khách nhỏ | 0 % (0/9.001) | 0 % (0/9.001) | ≤ 0,1 % | Đạt, nhưng bản trước cũng đạt: request chờ chứ không lỗi |
| Số kết nối PostgreSQL cao nhất | 20, 20 | 6, 12 | ≤ ngưỡng đặt | Đạt, tổng cấu hình là 20 ở cả hai bản |
| Báo cáo của khách lớn hoàn tất (30 báo cáo, retry theo `Retry-After`) | 30/30, 30/30 | 30/30, 30/30 | 100 % | Đạt |
| Thời gian chờ chỗ trong khoang tương tác, p99 | không có khoang | 0,0 ms, lớn nhất 0,3 ms | ≤ 20 ms | Đạt |

**Khách nhỏ** (đơn vị ms, kịch bản 30 báo cáo liên tục):

| Lượt | Bản | p50 | p95 | p99 | Lớn nhất |
|---|---|---|---|---|---|
| `main` | Trước | 3.351,3 | 4.914,5 | 5.018,3 | 5.135,9 |
| `main` | Sau | 2,8 | 4,2 | 6,1 | 49,2 |
| `round-2` | Trước | 3.430,2 | 4.919,5 | 5.018,9 | 5.224,6 |
| `round-2` | Sau | 2,6 | 4,2 | 8,2 | 504,2 |

**Khách lớn trả giá gì** (3 phút, lượt `main`; lượt `round-2` cho cùng số đếm):

| | Trước | Sau |
|---|---|---|
| Báo cáo xong | 695 | 39 |
| Báo cáo bị từ chối 429 | 0 | 936 |
| p95 thời gian một báo cáo | 9.988,9 ms | 20.055,0 ms |
| p95 yêu cầu xuất dữ liệu | 7.182,8 ms | 7,8 ms (trả 202, worker làm sau) |

**Đọc số này thế nào**
- Mức chênh ở khách nhỏ đến từ cách chia tài nguyên: cùng 20 kết nối, p99 từ 5 giây còn vài mili giây.
- Bản trước **không có lỗi nào**, khác 40 % minh họa ở mục 5: `pg` xếp hàng không giới hạn, báo cáo chỉ 5 giây và client chờ tới 30 giây, nên request chậm chứ không hỏng. Thời gian chờ khoảng 5 giây chính là độ dài một báo cáo. Báo cáo 20 – 40 giây như mục 1 sẽ chờ lâu hơn, nhưng lab không đo.
- Khách lớn chịu thiệt thật: số báo cáo xong giảm 695 còn 39, khoảng 18 lần, vì tenant chỉ được chạy 1 báo cáo cùng lúc. Đó là quyết định nghiệp vụ, phải ghi vào hợp đồng. Giới hạn `perTenant` cao hơn sẽ đổi một phần bảo vệ lấy thông lượng; lab chưa đo mức khác.
- Kết nối cao nhất của bản sau chỉ 6 và 12, nghĩa là phần lớn thời gian bản sau **để trống** tài nguyên trong khi khách lớn bị từ chối. Đây là cái giá của vách ngăn đã nêu ở mục 2.
- Lượt `round-2` có một ghi chú 504,2 ms, cao hơn hẳn phần còn lại. Nguyên nhân chưa tách riêng được.
- 30 báo cáo đều xong ở cả hai bản, nhưng bản sau mỗi lần chỉ chạy một báo cáo nên cần ít nhất 150 giây; bản trước xong trong vài lượt của pool. Thời gian chạy của cả kịch bản là 170 giây ở cả hai bản do khách nhỏ chạy suốt, nên không so được tổng thời gian.

**Test:** 15/15 đạt trên PostgreSQL và PGMQ thật. `node scripts/kiem-chung-lab.mjs` đạt 6/6 bước từ volume sạch. Đã kiểm trực tiếp trên Compose: `bulkhead_wait_seconds` tới được Prometheus.

**Phép thử âm** (`pnpm bench:drills`, số test đỏ trên số test của file bảo vệ phần đó):

| Gỡ phần nào của pattern | Test đỏ |
|---|---|
| Dùng chung một pool cho hai khoang | 1/5 |
| Không trả chỗ khi xong | 2/2 |
| Giới hạn theo khoang, không theo tenant | 1/2 |
| Hàng chờ không giới hạn | 1/6 |
| Hàng chờ không có thời gian tối đa | 2/6 |
| Xuất dữ liệu ngay trong request | 1/5 |

**Hạn chế:** một instance và một máy, báo cáo giả lập bằng `pg_sleep` nên không tốn CPU hay I/O của PostgreSQL, tức lab chỉ đo tranh chấp kết nối. Báo cáo 5 giây, lượt 3 phút, ngắn hơn mục 1 và mục 8.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Dung lượng bị chia: lúc thấp tải, khoang báo cáo rảnh nhưng request tương tác không dùng được phần đó.
- Thêm tham số (kích thước pool, giới hạn tenant, hàng chờ) phải chỉnh theo dữ liệu; đặt sai thì từ chối oan. Khách lớn thấy 429 — cần hợp đồng nói rõ, và client của họ phải retry đúng cách.

**Không nên dùng khi**
- Một loại tải, tenant đồng đều, tài nguyên còn dư: chia khoang chỉ làm lãng phí.
- Nguyên nhân là truy vấn tệ (thiếu index, N+1): sửa truy vấn trước.
- Hệ thống nhỏ một instance: một giới hạn đồng thời toàn cục kèm timeout thường đã đủ.

**Liên quan**
- Đọc trước: `../03-circuit-breaker-service-khuyen-mai-cham-lam-sap-checkout/` — bộ ba stability patterns; `../../02-backend-database/03-connection-pool-200-pod-dap-postgres/`.
- Cùng chủ đề: `../../13-backend-transporter/03-rate-limiting-mot-khach-api-goi-10k-req-s/` — giới hạn theo thời gian; `../../02-backend-database/07-multi-tenant-saas-300-cong-ty-chung-mot-db/`; `../../18-backend-scale/05-load-shedding-qua-tai-thi-tu-choi-mot-phan-thay-vi-sap-het/`; đưa việc dài ra hàng đợi: `../../14-backend-queueing/01-work-queue-gui-100k-email-lam-treo-api/`; tách tải đọc: `../../02-backend-database/05-read-replica-bao-cao-cuoi-thang-lam-cham-tao-don/`.

## 7. Cơ sở tham khảo

- Michael Nygard, *Release It!*, 2nd ed., Pragmatic Bookshelf, 2018 — Stability Patterns: Bulkheads; cách chia tài nguyên để một phần hỏng không kéo theo toàn hệ thống.
- Microsoft Azure Architecture Center, "Bulkhead pattern" — https://learn.microsoft.com/azure/architecture/patterns/bulkhead — phân vùng instance và pool theo người dùng, các vấn đề cần cân nhắc khi chọn độ mịn.
- Microsoft, "Architect multitenant solutions on Azure" — https://learn.microsoft.com/azure/architecture/guide/multitenant/overview — vấn đề noisy neighbor và các mức cách ly trong hệ đa tenant.
- node-postgres docs, "Pool" — https://node-postgres.com/apis/pool — cấu hình kích thước pool và thời gian chờ kết nối.
- cockatiel — https://github.com/connor4312/cockatiel — bulkhead policy với giới hạn thực thi và hàng chờ dùng ở mục 4.
- PostgreSQL docs, "Client Connection Defaults" — https://www.postgresql.org/docs/16/runtime-config-client.html — `statement_timeout`.

## 8. Kế hoạch thực hành

- [x] Bước 1: dựng `crm-api` một pool chung, seed 300 tenant (một tenant chiếm 35 % dữ liệu), endpoint ghi chú và báo cáo pipeline chậm có chủ đích.
- [x] Bước 2: đo "trước": k6 hai kịch bản song song trong 10 phút; ghi p99 và tỷ lệ lỗi của khách nhỏ, số kết nối PostgreSQL cao nhất.
- [x] Bước 3: thêm bộ phân loại, hai pool, bulkhead theo (khoang, tenant) có hàng chờ, `statement_timeout`, chuyển xuất dữ liệu sang PGMQ worker.
- [x] Bước 4: đo "sau" cùng kịch bản, ghi số thật và môi trường vào mục 5. *(Không thử tăng số instance: lab có một instance.)*
- [x] Bước 5: test: (a) khoang báo cáo đầy không làm chậm request tương tác; (b) tenant vượt giới hạn nhận 429 kèm `Retry-After`, tenant khác không bị; (c) lỗi và timeout luôn trả chỗ trong khoang; (d) tổng kết nối không vượt ngưỡng cấu hình.

**Cấu trúc code**
```text
src/
  crm-api/
    tenant-bulkhead.ts             # [PATTERN] semaphore theo (khoang, tenant), hàng chờ có giới hạn và hẹn giờ
    bulkhead.interceptor.ts        # [PATTERN] xin chỗ, trả 429 kèm Retry-After, trả chỗ ở finalize
    compartment.classifier.ts      # gắn request vào khoang theo route
    db-pools.ts                    # [PATTERN] pool tương tác và pool báo cáo, statement_timeout theo khoang
    crm.module.ts, metrics.ts      # ghi chú, báo cáo, xuất dữ liệu
  export-worker/worker.ts          # PGMQ, concurrency cố định
  shared/                          # log, correlation id, khởi động app, đọc hàng đợi
test/
  tenant-bulkhead.test.ts
  full-report-compartment-does-not-slow-notes.test.ts
  tenant-over-limit-gets-429.test.ts
  slot-released-on-error.test.ts
bench/
  noisy-neighbor.k6.js
  run-scenario.ts                  # đo một bản, lấy mẫu pg_stat_activity mỗi giây
  show-results.mjs
  negative-drills.ts
docker-compose.yml                 # postgres; profile stack, worker, bench
```

**Cách chạy** *(chỉ cần Docker; k6 chạy trong container)*
```bash
pnpm install                 # tự gói dist/*.cjs
docker compose up -d --wait  # chỉ dựng PostgreSQL có PGMQ
pnpm typecheck && pnpm test
pnpm bench:drills            # phép thử âm, cần PostgreSQL đang chạy
docker compose down -v

# Đo hai bản, mỗi lệnh khoảng 6 phút và tự dọn sau khi xong; đừng gập nắp máy trong lúc đo
pnpm bench:scenario --variant truoc --run main
pnpm bench:scenario --variant sau --run main
pnpm bench:show main
```

## Bài học sau khi làm

- Cùng 20 kết nối, p99 của khách nhỏ từ 5 giây còn vài mili giây. Không thêm tài nguyên, chỉ chia lại.
- Bulkhead không miễn phí và phải nói rõ: khách lớn từ 695 báo cáo còn 39 trong 3 phút, và bản sau để trống kết nối trong khi vẫn từ chối họ. Đó là quyết định nghiệp vụ.
- Giới hạn theo tenant làm phần lớn công việc trong kịch bản một khách lớn. Tách pool chỉ phát huy khi nhiều tenant cùng chạy báo cáo, điều mà phép thử âm đã lộ ra.
- Phép thử âm bắt được 3 test xanh giả dù bộ test báo 15/15. Với bulkhead, test phải có tranh chấp đồng thời thật.
- Đọc mã nguồn thư viện trước khi dựa vào nó: bulkhead của `cockatiel` không hết hạn đúng lúc trong hàng chờ.
- Bản trước không lỗi mà chỉ chậm: `pg` xếp hàng không giới hạn. Chỉ nhìn tỷ lệ lỗi thì sự cố này vô hình.
