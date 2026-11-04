# Decompose by Bounded Context — Tách service theo nghiệp vụ (đơn hàng, kho, thanh toán) thay vì theo bảng

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 07 · backend / microservices | 🟢 Cơ bản | ✅ Hoàn thành | Bounded Context — Evans, *Domain-Driven Design* (2003); Decompose by subdomain — Richardson, microservices.io (2018) | 2026-11-04 |

> **Một câu tóm tắt:** Chia hệ thống theo *ranh giới nghiệp vụ* (mỗi context có mô hình và ngôn ngữ riêng) thay vì theo *bảng dữ liệu*, để một quy trình kinh doanh chỉ chạm vào một hoặc hai service và một đội có thể đổi mô hình của mình mà không kéo đội khác theo.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
Sàn thương mại điện tử tầm trung, 25 kỹ sư chia 4 đội, khoảng 40.000 đơn/ngày. Năm trước đội kỹ thuật tách monolith thành 6 service theo bảng dữ liệu lớn nhất: `product-service` quản bảng `products`, `order-service` quản bảng `orders`, `user-service`, `stock-service`, `payment-service`, `promotion-service`. Mỗi service về bản chất là một lớp CRUD mỏng bọc một bảng.

**Triệu chứng người kinh doanh nhìn thấy**
- Tính năng "đặt trước hàng sắp về" mất 6 tuần vì phải sửa 4 service của 3 đội và phối hợp 3 lịch deploy khác nhau.
- Một lần `product-service` bị chậm, toàn bộ luồng đặt hàng dừng dù khách chỉ cần giá đã chốt trong giỏ; doanh thu buổi tối hôm đó mất khoảng 30 phút.
- Đội kho muốn đổi cách lưu "tồn kho theo kho hàng" nhưng không dám, vì 5 service khác đang đọc trực tiếp cấu trúc cũ.

**Nguyên nhân kỹ thuật**
Tách theo bảng tạo ra các "entity service": mỗi service sở hữu *dữ liệu* nhưng không sở hữu *quy tắc nghiệp vụ*. Quy tắc "đặt hàng" bị trải trên 5 service nên mỗi request đặt hàng cần 9 lần gọi mạng tuần tự, mỗi thay đổi nghiệp vụ là thay đổi ở nhiều đội, và mọi service đều phụ thuộc vào mọi service khác. Khái niệm "sản phẩm" bị ép thành *một* mô hình dùng chung cho mọi nơi, dù Catalog cần mô tả và ảnh, Kho cần SKU và số lượng, Đơn hàng chỉ cần tên và giá tại thời điểm mua.

**Ràng buộc**
- Không thể dừng hệ thống để tách lại; phải đi từng bước trên hệ đang chạy.
- Mỗi đội 5–7 người, muốn deploy độc lập; hạ tầng hiện có là Docker trên VM, chưa có Kubernetes.
- Ngân sách kỹ thuật cho việc tái cấu trúc là một quý, song song với tính năng mới.

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** ranh giới service được vẽ theo *dữ liệu* (danh từ) thay vì theo *nghiệp vụ và ngôn ngữ* của từng nhóm người dùng, nên không có service nào tự hoàn thành được một quy trình.

**Pattern giải quyết thế nào:** Evans gọi mỗi vùng nghiệp vụ có mô hình và ngôn ngữ nhất quán là một *Bounded Context*. Cùng một từ "sản phẩm" được phép có mô hình khác nhau trong Catalog, Inventory và Ordering; ranh giới giữa chúng được vẽ tường minh trên *Context Map*, với quan hệ rõ ràng (ai là upstream, ai phải dịch dữ liệu qua Anti-Corruption Layer). Richardson đưa ý này vào microservices dưới tên "Decompose by subdomain": một service cho một subdomain, service sở hữu cả dữ liệu lẫn quy tắc, giao tiếp bằng lệnh và sự kiện ở ranh giới. Kết quả là luồng đặt hàng nằm gọn trong Ordering, chỉ gọi Inventory để đặt giữ và Payment để thu tiền; Catalog thay đổi mô hình tùy ý vì Ordering giữ bản sao giá đã chốt.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (cache giữa service, gọi song song) | Giảm độ trễ của 9 lần gọi | Không đổi số đội phải sửa cho một tính năng; rủi ro domino khi một service hỏng vẫn còn |
| Tách theo lớp kỹ thuật (api-service, business-service, data-service) | Rõ ràng về mặt kỹ thuật | Mỗi tính năng vẫn đi qua mọi lớp, tức mọi đội; đây là biến thể tệ hơn của tách theo bảng |
| Gộp lại thành modular monolith trước (`08` bài 05) | Tìm ranh giới nghiệp vụ với chi phí thấp, không cần mạng | Là lựa chọn rất đáng; ở bài này giả định đã tách và cần vẽ lại ranh giới trên hệ đang chạy, nhưng mục 8 vẫn dùng module hóa làm bước trung gian |
| Decompose by Bounded Context (chọn) | Mỗi quy trình thuộc một chủ sở hữu; mô hình và ngôn ngữ độc lập theo context | Đòi phân tích nghiệp vụ, nhưng là cách duy nhất giải quyết nguyên nhân gốc |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước: tách theo bảng"]
    direction TB
    CK["Checkout API"]:::cu
    PS["product-service<br/>bảng products"]:::loi
    OS["order-service<br/>bảng orders"]:::loi
    US["user-service<br/>bảng users"]:::loi
    SS["stock-service<br/>bảng stock"]:::loi
    PM["payment-service<br/>bảng payments"]:::loi
    CK --> PS & OS & US & SS & PM
  end

  subgraph SAU["Sau: tách theo bounded context"]
    direction TB
    ORD["Ordering<br/>đơn hàng, dòng hàng, giá đã chốt"]:::moi
    CAT["Catalog<br/>mô tả, ảnh, danh mục"]:::moi
    INV["Inventory<br/>SKU, tồn kho, đặt giữ"]:::moi
    PAY["Payment<br/>giao dịch, hoàn tiền"]:::moi
    ACL["Lớp dịch sự kiện<br/>Anti-Corruption Layer"]:::moi
    ORD -->|"lệnh đặt giữ"| INV
    ORD -->|"lệnh thu tiền"| PAY
    CAT -.->|"sự kiện giá đổi"| ACL -.-> ORD
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  participant KH as Khách hàng
  participant ORD as Ordering
  participant INV as Inventory
  participant PAY as Payment
  participant CAT as Catalog
  KH->>ORD: Đặt hàng 2 SKU
  ORD->>ORD: Tạo đơn với giá đã chốt từ bản sao cục bộ
  ORD->>INV: Lệnh đặt giữ tồn kho, một lời gọi cho cả đơn
  INV-->>ORD: Đã giữ, hết hạn sau 15 phút
  ORD->>PAY: Lệnh thu tiền, chỉ gồm mã đơn và số tiền
  PAY-->>ORD: Đã thu
  ORD-->>KH: Đơn đã xác nhận
  Note over ORD,CAT: Catalog đổi cấu trúc mô tả sản phẩm cùng lúc, Ordering không cần biết
  CAT-->>ORD: Sự kiện ProductPriceChanged
  ORD->>ORD: Lớp dịch chuyển sự kiện sang mô hình Ordering, bỏ qua trường lạ
  alt Catalog ngừng hoạt động
    KH->>ORD: Đặt hàng tiếp
    ORD->>ORD: Vẫn tạo đơn bằng bản sao giá cục bộ
    ORD-->>KH: Đơn đã tạo
  end
```

### 3.3 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| Ordering | Vòng đời đơn hàng, giỏ hàng, giá đã chốt; điều phối đặt giữ và thu tiền | Giữ bản sao tên và giá sản phẩm tại thời điểm mua; không join sang Catalog |
| Catalog | Mô tả, ảnh, danh mục, giá niêm yết | Là upstream của Ordering; phát sự kiện khi giá đổi, không biết ai tiêu thụ |
| Inventory | Tồn kho theo kho hàng, đặt giữ có hạn | Khái niệm "sản phẩm" ở đây là SKU và số lượng, khác hẳn Catalog |
| Payment | Thu tiền, hoàn tiền, đối soát | Chỉ nhận lệnh từ Ordering kèm mã đơn; không đọc bảng đơn hàng |
| Anti-Corruption Layer trong Ordering | Dịch sự kiện và dữ liệu từ context khác sang mô hình của Ordering | Mỗi context dịch ở phía *nhận*, nên upstream đổi mô hình chỉ cần sửa lớp dịch |
| Context Map (tài liệu) | Ghi quan hệ upstream/downstream giữa các context | Là hợp đồng giữa các đội; cập nhật trước khi đổi ranh giới |

### 3.4 Điểm dễ sai khi triển khai
- **Tách theo danh từ.** Thấy bảng `products` là tạo `product-service`. Dấu hiệu: service chỉ có CRUD, không có quy tắc nghiệp vụ nào. Cách tránh: liệt kê *quy trình* (đặt hàng, nhập kho, hoàn tiền) rồi hỏi "ai sở hữu quy tắc này".
- **Một mô hình "sản phẩm" dùng chung** qua thư viện chia sẻ. Thư viện chung biến mọi context thành một context lớn ngụy trang. Cách tránh: mỗi context tự định nghĩa kiểu của mình; chỉ chia sẻ hợp đồng sự kiện.
- **Context quá nhỏ.** Tách "giỏ hàng" và "đơn hàng" thành hai service khi chúng luôn thay đổi cùng nhau tạo ra gọi mạng vô nghĩa. Dấu hiệu: hai service luôn deploy cùng lúc.
- **Bỏ qua Context Map.** Không ghi ai upstream của ai dẫn tới sửa một sự kiện làm hỏng ba consumer. Cách tránh: mỗi sự kiện có chủ sở hữu và phiên bản (xem `13` bài 02).
- **Nhảy thẳng sang mạng.** Vẽ lại ranh giới trong một codebase (module) trước, rồi mới tách tiến trình khi ranh giới đã ổn vài tháng.
- **Ném lỗi khi gặp sự kiện không hiểu.** Gặp khi viết lớp dịch: message không được archive sẽ quay lại sau visibility timeout và lặp mãi. Lớp dịch phải trả kết quả "cách ly" để consumer ghi vào `ordering.quarantined_events` rồi đi tiếp. Phép thử âm "ném lỗi thay vì cách ly" làm test đỏ.
- **Luật ESLint chỉ bắt import tĩnh.** `no-restricted-imports` không thấy `await import()` hay `require()` dựng từ biến, nên `test/context-boundaries.test.ts` có thêm bộ đếm riêng phân giải đường dẫn thật. Bộ đếm này cũng không bắt được đường dẫn dựng lúc chạy.
- **Phép thử âm "đạt" giả khi DB chưa bật.** Bản đầu của `bench/negative-drills.ts` coi test đỏ là đạt, nên DB tắt thì mọi kịch bản đều "đạt". Script nay đòi test xanh trước khi sửa mã nguồn.

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ngôn ngữ | TypeScript strict, Node 20+ | Trùng stack của repo; kiểu dữ liệu riêng từng context lộ rõ qua type | Go, Java |
| Ứng dụng | NestJS, một ứng dụng cho mỗi context trong `apps/` | Module và DI của NestJS ép ranh giới qua `exports`; dễ chạy riêng từng app | Fastify thuần |
| Dữ liệu | PostgreSQL 16, một schema cho mỗi context, role riêng | Tái hiện "dữ liệu riêng" mà vẫn một máy chủ cho bài thực hành (xem bài 02) | Một database riêng cho mỗi context |
| Sự kiện giữa context | PGMQ | Hàng đợi trong Postgres, không thêm hạ tầng; đủ cho sự kiện giá đổi | NATS JetStream, RabbitMQ |
| Ranh giới code | ESLint `no-restricted-imports` theo đường dẫn context | Chặn import chéo ngay lúc lint, không cần công cụ mới | dependency-cruiser, Nx module boundaries |
| Hạ tầng local | Docker Compose | Một lệnh dựng Postgres và 4 app | — |
| Test và đo | Vitest, k6, log có correlation id | Vitest cho hành vi; k6 đo độ trễ đặt hàng; correlation id đếm số service một request đi qua | OpenTelemetry + Jaeger |

**Thay đổi so với hệ thống hiện tại:** gộp 6 entity service thành 4 context theo nghiệp vụ; mỗi context nhận lại quy tắc của mình từ Checkout API; thêm lớp dịch sự kiện ở phía nhận; đội vận hành phải quen với việc dữ liệu được nhân bản có chủ đích (giá đã chốt trong Ordering) và học đọc Context Map khi điều tra sự cố.

**Ghi chú khi làm lab**
- Phiên bản: NestJS 10.4.22 (`platform-express`), `pg` 8.23.1, TypeScript 5.9.3, ESLint 10.12.0, `typescript-eslint` 8.71.1, Vitest 5.0.3, esbuild 0.28.2, PostgreSQL có PGMQ từ `ghcr.io/pgmq/pg16-pgmq:v1.13.0`, k6 `grafana/k6:1.4.2`.
- Dùng `pg` trực tiếp thay vì Kysely: truy vấn ít và mỗi context có schema riêng, thêm query builder không giúp chứng minh pattern.
- `customers` và `promotions` nằm trong Ordering vì bài chỉ có 4 context và chưa có quy trình riêng cho hai thứ này (xem `docs/context-map.md`).
- Gọi HTTP giữa service dùng `fetch` có sẵn của Node, timeout 2 giây. Không dùng `@nestjs/microservices`: mục này chọn HTTP và PGMQ, mà NestJS không có transporter sẵn cho PGMQ.
- Mỗi app được esbuild gói thành một file `dist/<app>.cjs` chạy trên `node:20-alpine`, theo mẫu 23/01. Dùng CommonJS vì NestJS và Express là CommonJS. Vì esbuild không phát `design:paramtypes`, mọi tham số constructor ghi `@Inject` tường minh (nhật ký 08/01 điểm 1).
- Test chạy các app NestJS ngay trong tiến trình test trên cổng ngẫu nhiên, nên "tắt Catalog" là đóng app đó. Đo tải thì chạy container thật, và `bench/run-place-order.ts` dừng đúng container Catalog.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| Số service một request đặt hàng đi qua | 5 | ≤ 3 (Ordering, Inventory, Payment) | Đếm service xuất hiện trong log có cùng correlation id |
| Số lần gọi mạng tuần tự cho một lần đặt hàng | 9 | ≤ 3 | Đếm dòng log outbound theo correlation id; k6 ghi độ trễ |
| p95 độ trễ đặt hàng ở 50 request/giây | 1.400 ms | ≤ 400 ms | k6, kịch bản 5 phút, cùng máy, ghi môi trường |
| Tỷ lệ đặt hàng thành công khi Catalog bị tắt | 0 % | 100 % | Test tích hợp: dừng container Catalog, chạy kịch bản đặt hàng |
| Số import chéo giữa các context | không đo được | 0 | ESLint `no-restricted-imports` chạy trong CI |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** một tính năng về đơn hàng chỉ cần một đội và một lịch deploy; sự cố ở Catalog không làm mất doanh thu đặt hàng; đội kho được tự do đổi mô hình tồn kho.

### 5.1 Số đã đo

**Môi trường** (đo ngày 2026-11-04): Apple M5, 10 nhân, 32 GB RAM, macOS (Darwin 25.6.0), chạy pin, mở nắp, không có khoảng ngủ. Docker Desktop 29.9.2, Compose v5.6.1, máy ảo Docker 10 CPU và 7,75 GiB RAM. PostgreSQL 16.15, PGMQ 1.13.0, service trên `node:20-alpine` (Node 20.20.2), k6 1.4.2. Service, database và k6 chạy cùng mạng Compose, nên "gọi mạng" ở đây là gọi trong một máy. Load 1 phút của macOS: 2,7 – 4,7. Máy có tiến trình của dự án khác chạy cùng lúc.

**Tải:** mô hình mở 50 request/giây trong 5 phút, mỗi đơn 2 SKU, seed 1.000 khách và 1.000 SKU. Hai bản nhận cùng một chuỗi request. Mỗi bản dựng từ volume sạch, chạy tuần tự trên một máy. Bản trước và bản sau đều 15.001/15.001 đơn thành công, không rớt iteration nào.

| Chỉ số | Trước | Sau | Mục tiêu | Kết luận |
|---|---|---|---|---|
| Số service một đơn đi qua | 6 (5 entity service + `checkout-api`) | 3 | ≤ 3 | Đạt, giống nhau ở cả 15.001 đơn |
| Số lần gọi mạng tuần tự | 9 | 2 | ≤ 3 | Đạt, giống nhau ở cả 15.001 đơn |
| p95 đặt hàng ở 50 request/giây | 11,4 ms | 8,8 ms | ≤ 400 ms | Đạt, nhưng bản trước cũng đạt nên chỉ số này không phân biệt được hai bản ở lab (xem dưới) |
| Tỷ lệ đặt hàng thành công khi tắt Catalog | 0 % (0/1.500, tắt `product-service`) | 100 % (1.501/1.501) | 100 % | Đạt, lượt 30 giây sau khi dừng container |
| Số import chéo giữa các context | không áp dụng | 0 | 0 | Đạt: ESLint và bộ đếm độc lập trong `test/context-boundaries.test.ts` |

**Độ trễ chi tiết** (lượt chính 5 phút, đơn vị ms):

| Bản | p50 | p95 | p99 | Lớn nhất |
|---|---|---|---|---|
| Trước | 6,3 | 11,4 | 19,6 | 162,8 |
| Sau | 4,7 | 8,8 | 13,4 | 308,1 |

**Ba vòng 60 giây, xoay thứ tự** (mỗi vòng 3.000 – 3.001 đơn mỗi bản, đơn vị ms):

| Vòng | Thứ tự chạy | Trước p50 / p95 | Sau p50 / p95 | Chênh p95 |
|---|---|---|---|---|
| 1 | sau, trước | 6,2 / 10,4 | 4,6 / 7,6 | 2,8 |
| 2 | trước, sau | 6,4 / 10,4 | 4,8 / 8,4 | 1,9 |
| 3 | sau, trước | 6,9 / 11,9 | 4,7 / 8,6 | 3,3 |

**Đọc số độ trễ thế nào**
- Bản sau nhanh hơn ở mọi vòng và hai dải p95 không chồng nhau (trước 10,4 – 11,9; sau 7,6 – 8,6), nhưng chỉ khoảng 2 – 3 ms. Số 1.400 ms trong bảng trên là minh họa; lab không tái hiện được mức đó.
- Lý do chính là cả hệ chạy trong một máy, mỗi lời gọi rất rẻ. Lab không đo được bớt 7 lời gọi sẽ tiết kiệm bao nhiêu trên mạng thật giữa các máy; muốn biết phải tiêm độ trễ vào từng lời gọi.
- Bản sau chạy nhiều câu SQL hơn: 14 so với 9 mỗi đơn (đếm từ code, gồm `BEGIN` và `COMMIT`), vì có trạng thái `PENDING` và giữ cả đơn trong transaction. Phần này ăn bớt lợi ích của việc bớt lời gọi, nhưng chưa tách riêng được bao nhiêu.
- Giá trị lớn nhất của bản sau cao hơn ở lượt chính (308,1 so với 162,8 ms); ở ba vòng 60 giây, bản sau có 88,0, 58,6 và 276,2 ms, bản trước có 168,4, 165,8 và 178,2 ms. Mỗi số chỉ là một request, nguyên nhân chưa tách riêng được.
- Lợi ích đo được chắc chắn của bài là số lời gọi và khả năng chịu lỗi (0 % so với 100 %), không phải độ trễ.

**Test:** 34/34 đạt trên PostgreSQL và PGMQ thật. `node scripts/kiem-chung-lab.mjs` đạt 7/7 bước từ volume sạch.

**Phép thử âm** (`pnpm bench:drills`, cột "test đỏ" là số test đỏ trên số test của file bảo vệ phần đó):

| Gỡ phần nào của pattern | Test đỏ | Test nào đỏ |
|---|---|---|
| Ordering gọi Catalog lúc đặt hàng | 1/2 | Tắt Catalog, mọi đơn vẫn được xác nhận |
| Lớp dịch ném lỗi thay vì cách ly | 1/6 | Sự kiện đổi tên không báo phiên bản bị cách ly |
| Lớp dịch chỉ hiểu v1 | 2/6 | Dịch v2, và Catalog phát v2 tới đơn hàng |
| Bỏ điều kiện phiên bản khi ghi bản sao giá | 1/4 | Sự kiện cũ tới muộn không kéo giá về bản trước |
| Tắt luật chặn import chéo của Ordering | 2/6 | ESLint chặn import kiểu, chặn mọi cặp context |

**Hạn chế:** mọi service chung một PostgreSQL và một máy, nên kết quả độ trễ không áp dụng cho triển khai nhiều máy. Mỗi cấu hình một lượt 5 phút và ba vòng 60 giây. Chạy pin, cùng nguồn điện cho cả hai bản. Tải 50 request/giây nhẹ so với sức máy, nên lab chưa cho thấy hai bản khác nhau thế nào khi gần bão hòa.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Dữ liệu nhân bản có chủ đích (giá, tên sản phẩm trong Ordering) nghĩa là chấp nhận nhất quán cuối; phải có cơ chế sự kiện và xử lý trùng (`14` bài 04).
- Phân tích nghiệp vụ tốn thời gian và cần người hiểu nghiệp vụ ngồi cùng; ranh giới sai lần đầu là bình thường, cần sẵn sàng vẽ lại.
- Nhiều ứng dụng hơn để vận hành so với một monolith; chi phí này chỉ hợp lý khi đội đủ lớn để sở hữu từng context.

**Không nên dùng khi**
- Đội dưới 8 người hoặc nghiệp vụ còn thay đổi hằng tuần: ranh giới chưa ổn thì tách tiến trình chỉ nhân đôi công sửa. Dùng modular monolith (`08` bài 05).
- Hệ thống chủ yếu là CRUD mỏng trên vài bảng, không có quy trình nhiều bước: không có gì để "sở hữu" ngoài bảng.
- Không có khả năng chạy hạ tầng sự kiện và quan sát (log tập trung, correlation id): tách context mà không thấy được luồng là tự làm khó khi sự cố.

**Liên quan**
- Đọc trước: `../../08-backend-monolith/05-modular-monolith-team-15-nguoi-dung-nhau-trong-mot-codebase/` — vẽ ranh giới trong một codebase trước khi tách.
- Đọc sau: `../02-database-per-service-hai-service-cung-sua-mot-bang/` — dữ liệu riêng cho từng context; `../07-saga-dat-hang-tru-kho-thanh-toan-hoan-tien-khi-loi/` — quy trình xuyên context khi một bước lỗi.
- Cùng chủ đề: `../../13-backend-transporter/02-schema-evolution-them-field-lam-sap-consumer-cu/` — tiến hóa hợp đồng sự kiện giữa context.

## 7. Cơ sở tham khảo

- Eric Evans, *Domain-Driven Design*, Addison-Wesley, 2003 — phần IV "Strategic Design": định nghĩa Bounded Context, Context Map, Anti-Corruption Layer; là nguồn gốc của ý "một từ, nhiều mô hình".
- Chris Richardson, "Pattern: Decompose by subdomain" và "Decompose by business capability", microservices.io — https://microservices.io/patterns/decomposition/decompose-by-subdomain.html — cách áp Bounded Context vào việc chia service, kèm nhược điểm cần tránh.
- Sam Newman, *Building Microservices*, 2nd ed., O'Reilly, 2021 — chương về mô hình hóa microservices: information hiding, coupling và cohesion làm tiêu chí vẽ ranh giới.
- Microsoft Azure Architecture Center, "Anti-Corruption Layer pattern" — https://learn.microsoft.com/azure/architecture/patterns/anti-corruption-layer — lớp dịch ở phía nhận dùng trong mục 3.
- NestJS docs, "Modules" — https://docs.nestjs.com/modules — cơ chế `exports` dùng để ép ranh giới trong code.

## 8. Kế hoạch thực hành

- [x] Bước 1: dựng 6 entity service tối giản (NestJS, mỗi service một bảng) và một Checkout API gọi tuần tự; Docker Compose với Postgres và PGMQ.
- [x] Bước 2: đo "trước": k6 đặt hàng 50 request/giây trong 5 phút; đếm service và số lần gọi theo correlation id; tắt `product-service` và ghi tỷ lệ thành công.
- [x] Bước 3: viết Context Map (file Markdown trong bài), gộp lại thành 4 context, chuyển quy tắc đặt hàng vào Ordering, thêm bản sao giá và lớp dịch sự kiện từ Catalog qua PGMQ; bật ESLint chặn import chéo.
- [x] Bước 4: đo "sau" cùng kịch bản, ghi số thật kèm môi trường vào mục 5.
- [x] Bước 5: test chứng minh: (a) tắt Catalog vẫn đặt hàng được; (b) đổi tên trường trong sự kiện Catalog không làm Ordering lỗi; (c) lint fail khi Ordering import kiểu từ Catalog.

**Cấu trúc code**
```text
apps/
  truoc/
    entity-services.ts            # 6 service CRUD mỏng, mỗi service một bảng
    checkout-api.ts               # quy tắc đặt hàng rải qua 9 lời gọi tuần tự
  ordering/
    place-order.service.ts        # [PATTERN] quy tắc đặt hàng có một chủ, không gọi Catalog
    acl/catalog-event-translator.ts  # [PATTERN] Anti-Corruption Layer
    catalog-event.consumer.ts     # [PATTERN] đọc PGMQ, chỉ bản mới hơn được ghi đè
    pricing.ts, order.repository.ts, upstream-clients.ts
  catalog/                        # [PATTERN] đổi giá và gửi sự kiện cùng transaction
  inventory/
  payment/
libs/platform/                    # chỉ hạ tầng: log, correlation id, gọi HTTP, pool DB
db/init/                          # 01 PGMQ, 02 schema và role, 03 seed
docs/context-map.md               # quan hệ upstream/downstream giữa 4 context
eslint.config.js                  # [PATTERN] chặn import chéo giữa các context
test/
  order-placed-while-catalog-down.test.ts
  catalog-event-field-rename-tolerated.test.ts
  order-hops.test.ts
  locked-price.test.ts
  order-rules.test.ts
  context-boundaries.test.ts
  data-ownership.test.ts
bench/
  place-order.k6.js
  run-place-order.ts              # đo một bản: k6, đếm lời gọi từ log, tắt một service
  negative-drills.ts
docker-compose.yml                # postgres; profile truoc, sau, bench
```

**Cách chạy** *(chỉ cần Docker; k6 chạy trong container)*
```bash
pnpm install                 # tự gói dist/*.cjs
docker compose up -d --wait  # chỉ dựng PostgreSQL có PGMQ
pnpm typecheck && pnpm lint && pnpm test
pnpm bench:drills            # phép thử âm, cần PostgreSQL đang chạy
docker compose down -v

# Đo hai bản, mỗi lệnh khoảng 6 phút và tự dọn sau khi xong
pnpm bench:place-order --variant truoc --run main
pnpm bench:place-order --variant sau --run main
```

## Bài học sau khi làm

- Bài học lớn nhất nằm ở chỗ chỉ số độ trễ không chứng minh được gì: mục tiêu ≤ 400 ms đặt theo số minh họa, nên bản "trước" cũng đạt với 11,4 ms. Trong một máy, 7 lời gọi ít hơn chỉ tiết kiệm 2 – 3 ms. Thứ bài này cải thiện được là số service phải cùng sống để bán hàng, và điều đó thấy rõ ở phép thử tắt service: 0 % so với 100 %.
- Con số "9 lời gọi" trong bối cảnh không cần ép: một đơn 2 SKU đi qua user, 2 lần product, 2 lần đọc tồn, 2 lần giữ hàng, payment, order là ra đúng 9. Bản sau còn 2 vì Inventory nhận cả đơn trong một lệnh, và mọi thứ còn lại đã nằm trong Ordering.
- Số 5 trong bảng chưa tính cửa vào. Đếm theo log thì bản trước là 6 service (có `checkout-api`), bản sau là 3 (có Ordering), nên mục 5.1 ghi rõ cách đếm.
- "Đổi tên trường không làm Ordering lỗi" có hai nghĩa khác nhau. Đổi có báo trước (`schemaVersion: 2`) thì chỉ sửa lớp dịch. Đổi không báo trước thì Ordering không thể tự hiểu; điều làm được là không sập và không chặn sự kiện sau, với giá giữ nguyên bản cũ tới khi đội Ordering xử lý hàng cách ly.
- Hạn chế của lab: `pgmq.send` cùng transaction với đổi giá chỉ làm được vì mọi context chung một PostgreSQL. Tách máy thì cần Transactional Outbox (14/03). Thu tiền lỗi sau khi đã giữ hàng cũng chưa được bù, phần đặt giữ chỉ tự hết hạn; đó là việc của Saga (07/07).
