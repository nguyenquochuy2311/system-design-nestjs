# Saga (choreography vs orchestration) — Đặt hàng → trừ kho → thanh toán: bước 3 lỗi thì hoàn kho thế nào khi không còn transaction chung

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 07 · backend / microservices | 🔴 Nâng cao | ✅ Hoàn thành | Saga — Garcia-Molina & Salem, SIGMOD 1987; Richardson, *Microservices Patterns* (2018) | 2026-11-04 |

> **Một câu tóm tắt:** Chia quy trình đặt hàng thành chuỗi transaction cục bộ ở từng service, mỗi bước có bước bù; một orchestrator lưu trạng thái saga trong database, gửi lệnh qua hàng đợi cùng transaction với việc đổi trạng thái, và khi thanh toán thất bại thì chạy bù theo thứ tự ngược — thay cho transaction phân tán không còn khả thi.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
Sàn thương mại điện tử đã tách `order-service`, `inventory-service`, `payment-service`, mỗi service một database (bài 01–02). Khoảng 40.000 đơn/ngày, đỉnh 30 đơn/giây lúc flash sale. Quy trình: tạo đơn → giữ hàng → trừ tiền qua cổng thanh toán → xác nhận đơn. Hiện `order-service` gọi HTTP tuần tự và "cố gắng" gọi API hoàn kho trong khối `catch` khi có lỗi.

**Triệu chứng người kinh doanh nhìn thấy**
- Mỗi tuần vài chục đơn "treo": hàng đã giữ nhưng thanh toán lỗi và không ai nhả; sản phẩm hiện "hết hàng" trong khi kho thật còn.
- Có đơn bị trừ tiền nhưng hiện "thất bại": cổng thanh toán trả timeout, hệ thống coi là lỗi, hủy đơn và nhả hàng; khách mất tiền, CSKH đối soát tay, mỗi sáng đội vận hành chạy script SQL sửa đơn lệch giữa ba database.

**Nguyên nhân kỹ thuật**
Không còn transaction ACID chung giữa ba database, và two-phase commit không khả thi vì cổng thanh toán bên ngoài không tham gia. Logic bù kiểu "try/catch rồi gọi hoàn kho" chỉ nằm trong bộ nhớ: nếu `order-service` crash giữa chừng hoặc chính lời gọi hoàn kho lỗi, không ai nhớ phải bù. Timeout bị coi là thất bại dù kết quả thật chưa biết.

**Ràng buộc**
- Không bao giờ trừ tiền mà không có đơn hợp lệ; hàng giữ quá 15 phút chưa thanh toán phải được nhả. Cổng thanh toán hỗ trợ idempotency key và API tra cứu trạng thái giao dịch.
- Mỗi service giữ database riêng, giao tiếp bất đồng bộ qua PGMQ đã có; phải trả lời được "đơn X đang ở bước nào, vì sao" trong 1 phút.

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** quy trình nghiệp vụ đi qua nhiều database nhưng không có nơi bền vững ghi nhớ đã làm tới đâu và phải hoàn tác gì khi bước sau thất bại.

**Pattern giải quyết thế nào:** Garcia-Molina và Salem định nghĩa saga là chuỗi transaction T1…Tn, mỗi Ti có bước bù Ci: hoặc mọi Ti hoàn tất, hoặc T1…Tj chạy rồi Cj…C1 hoàn tác. Richardson áp dụng cho microservices: mỗi bước là transaction cục bộ trong một service, các bước nối nhau bằng message. Có hai kiểu điều phối: *choreography* (mỗi service nghe event và tự quyết bước tiếp) và *orchestration* (một orchestrator gửi lệnh, nhận trả lời, giữ trạng thái). Richardson phân loại bước: *compensatable* (giữ hàng — có bù), *pivot* (trừ tiền thành công — điểm không quay lại), *retriable* (xác nhận đơn — chắc chắn thành công nếu thử lại). Saga thiếu tính cô lập nên cần *countermeasure*, ví dụ *semantic lock*: đơn ở trạng thái `PENDING` để mọi thao tác khác biết đơn đang dở. Bài chọn orchestration vì quy trình có luồng bù và yêu cầu trả lời "đơn đang ở đâu": trạng thái tập trung một chỗ dễ quan sát hơn chuỗi event rải ở ba service.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (try/catch gọi hoàn kho, script sửa mỗi sáng) | Không thêm thành phần | Crash giữa chừng vẫn quên bù; timeout vẫn bị coi là lỗi; công sửa tay tăng theo số đơn. |
| Saga choreography | Không có điều phối trung tâm | Luồng bù rải ở ba service, khó trả lời "đơn đang ở đâu"; thêm bước dễ tạo vòng event |
| Saga orchestration bằng Temporal | Workflow bền vững, retry và timer có sẵn | Thêm một cụm phải vận hành và che mất cơ chế cần học; làm ở bước tùy chọn để so sánh |
| Saga orchestration tự viết trên PostgreSQL + PGMQ (chọn) | Trạng thái một chỗ, chạy tiếp sau crash, dùng lại outbox và idempotent consumer | Thêm code phải test kỹ luồng bù; thiếu cô lập phải xử lý bằng countermeasure |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước"]
    direction LR
    O1["order-service<br/>try/catch gọi hoàn kho<br/>trong bộ nhớ"]:::loi
    I1["inventory-service"]:::cu
    P1["payment-service"]:::cu
    O1 -->|"HTTP tuần tự"| I1 & P1
  end

  subgraph SAU["Sau"]
    direction LR
    OR["Order Saga Orchestrator<br/>bảng order_sagas"]:::moi
    Q["PGMQ<br/>lệnh và trả lời"]:::moi
    I2["inventory-service<br/>ReserveStock, ReleaseStock"]:::cu
    P2["payment-service<br/>gọi cổng thanh toán,<br/>tra cứu khi timeout"]:::cu
    OR -->|"lệnh, cùng transaction<br/>với đổi trạng thái"| Q
    Q --> I2 & P2
    Q -->|"trả lời từ hai service"| OR
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  participant OS as Orchestrator
  participant INV as inventory-service
  participant PAY as payment-service
  participant GW as Cổng thanh toán
  OS->>INV: ReserveStock DH1, qua PGMQ
  INV-->>OS: StockReserved, lưu trạng thái CHARGING
  OS->>PAY: ChargePayment, idempotency key DH1
  PAY->>GW: Trừ tiền
  GW--xPAY: Timeout sau 10 giây, kết quả "chưa biết"
  PAY->>GW: Tra cứu giao dịch theo key DH1
  alt Cổng báo đã trừ tiền
    GW-->>PAY: Thành công
    PAY-->>OS: PaymentSucceeded, orchestrator xác nhận đơn
  else Cổng báo bị từ chối
    GW-->>PAY: Thẻ bị từ chối
    PAY-->>OS: PaymentFailed
    OS->>INV: Lệnh bù ReleaseStock DH1
    INV-->>OS: StockReleased, orchestrator hủy đơn
  end
```

### 3.3 Vòng đời saga

```mermaid
stateDiagram-v2
  state "Chờ giữ hàng" as RESERVING
  state "Chờ thanh toán" as CHARGING
  state "Đã xác nhận" as CONFIRMED
  state "Đang chốt với cổng, hoàn tiền nếu đã trừ" as VOIDING
  state "Đang bù, nhả hàng" as COMPENSATING
  state "Đã hủy" as CANCELLED
  [*] --> RESERVING
  RESERVING --> CHARGING : StockReserved
  RESERVING --> CANCELLED : OutOfStock
  RESERVING --> COMPENSATING : quá 15 phút
  CHARGING --> CHARGING : timeout, tra cứu lại
  CHARGING --> CONFIRMED : PaymentSucceeded
  CHARGING --> COMPENSATING : PaymentFailed
  CHARGING --> VOIDING : quá 15 phút
  VOIDING --> COMPENSATING : PaymentVoided
  COMPENSATING --> CANCELLED : StockReleased
```

### 3.4 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| Orchestrator + bảng `order_sagas` | Máy trạng thái: nhận trả lời, quyết định lệnh tiếp theo hoặc lệnh bù; một câu SQL trả lời "đơn X đang ở đâu" | Cột `version` chặn hai trả lời trùng cùng đẩy trạng thái; lưu lịch sử chuyển trạng thái kèm lý do |
| Gửi lệnh | Đổi trạng thái và gửi lệnh trong cùng một transaction | Lab dùng chung một PostgreSQL nên `pgmq.send` trong transaction là đủ; database tách máy thì cần outbox + relay (14/03) |
| Participant handler | Thực thi bước hoặc bước bù, trả lời kết quả | Idempotent theo `sagaId` + loại lệnh (14/04); payment chỉ trả `PaymentFailed` khi cổng xác nhận từ chối |
| Hạn 15 phút | Message trễ gửi cùng lúc tạo đơn, áp dụng cho mọi trạng thái chưa kết thúc | Đang ở `CHARGING` thì không nhả hàng ngay, mà sang `VOIDING` để chốt với cổng trước (14/07) |
| Hủy ở cổng (`VoidPayment`) | Bước bù của thanh toán: đã trừ thì hoàn tiền, chưa trừ thì khóa key | Idempotent; khóa key để lệnh trừ tiền tới muộn không trừ được nữa |

### 3.5 Điểm dễ sai khi triển khai
- **Coi timeout là thất bại rồi bù.** Đây là nguồn gốc "trừ tiền mà đơn hủy". Timeout phải dẫn tới tra cứu hoặc retry cùng idempotency key.
- **Bước bù không idempotent.** `ReleaseStock` tới hai lần nhả gấp đôi; bù theo `reservationId`, ghi nhận lệnh đã xử lý.
- **Bước bù được phép thất bại.** Về nghiệp vụ, bù phải hoàn tất: retry có backoff; lỗi vĩnh viễn vào DLQ kèm cảnh báo người xử lý (14/05).
- **Đặt pivot quá sớm.** Trừ tiền trước khi giữ hàng biến lỗi "hết hàng" thành hoàn tiền; đặt bước khó bù càng muộn càng tốt. Bù cũng không phải rollback: email "đặt hàng thành công" chỉ gửi khi saga ở `CONFIRMED`.
- **Hết hạn thì bù ngay.** Thiết kế đầu của bài chuyển thẳng `CHARGING` sang `COMPENSATING` khi quá 15 phút: nếu cổng đã trừ mà chưa kịp trả lời thì nhả hàng và hủy đơn, đúng lỗi bài muốn xóa. Phải chốt với cổng trước.
- **Không có hạn chót ở bước đầu.** Kho không trả lời thì saga kẹt ở `RESERVING` mãi. Hạn chót phải áp dụng cho mọi trạng thái chưa kết thúc.
- **Bù chạy song song với bước nó bù.** Lệnh bù tới cùng lúc lệnh giữ hàng: `UPDATE` không thấy dòng chưa commit nên bỏ sót, hàng bị giữ vĩnh viễn trong khi đã báo là nhả xong. Chèn tombstone trước, vì câu đó chờ transaction kia commit, rồi mới `UPDATE`.
- **Gửi lệnh ngoài transaction.** Phép thử âm cho thấy không chỉ có lệnh mồ côi: kho có thể trả lời trước khi đơn commit, orchestrator không thấy saga nên bỏ qua trả lời đó, và saga kẹt.

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ngôn ngữ, ứng dụng | TypeScript strict, NestJS cho 3 service; orchestrator là module trong `order-service` | Trùng stack repo | Fastify |
| Trạng thái saga | PostgreSQL 16, bảng `order_sagas` + `order_saga_transitions` | Khóa lạc quan theo version; lịch sử chuyển trạng thái để điều tra | — |
| Hàng đợi | PGMQ (`inventory_commands`, `payment_commands`, `saga_replies`) | Gửi trong cùng transaction; visibility timeout cho retry; message trễ cho hạn 15 phút | RabbitMQ hoặc NATS JetStream kèm outbox |
| Workflow engine (tùy chọn) | Temporal TypeScript SDK | So sánh với orchestrator tự viết: workflow tuần tự, timer, retry bền vững | AWS Step Functions, Camunda |
| Test, đo, hạ tầng | Cổng thanh toán giả (Fastify: idempotency key, tra cứu, chế độ timeout và từ chối); Vitest test tích hợp bắn lỗi có chủ ý, k6, script đối soát 3 database; Docker Compose | Tái hiện "chưa biết kết quả" có kiểm soát; chứng minh không còn đơn lệch | WireMock cho cổng giả |

**Thay đổi so với hệ thống hiện tại:** `POST /orders` trả `202` và trạng thái `PENDING` thay vì chờ cả quy trình; thêm orchestrator, ba hàng đợi, handler idempotent ở kho và thanh toán; giao diện hiển thị "đang xử lý". Đội vận hành thay script sửa tay bằng truy vấn `order_sagas` và theo dõi số saga kẹt quá 15 phút.

**Ghi chú khi làm lab**
- Phiên bản: NestJS 10.4.22, `pg` 8.23.1, Fastify 5.12.5 cho cổng giả, `ghcr.io/pgmq/pg16-pgmq:v1.13.0` (PostgreSQL 16.15, PGMQ 1.13.0), k6 1.4.2.
- Ba service dùng ba schema và ba role trên **một** PostgreSQL. Vì vậy mọi `pgmq.send` đều nằm cùng transaction với việc của service đó. Ba database riêng thì mỗi service cần Transactional Outbox (14/03); phần khó đó lab chưa làm. "Đối soát ba nơi" là đơn, kho và sổ cái của cổng.
- Bài chỉ code orchestration. Choreography chỉ được so sánh ở mục 2, dù tên bài có nhắc tới. Bước Temporal tùy chọn không làm.
- Máy trạng thái là hàm thuần trong `saga-machine.ts`, nên test được mọi tổ hợp trạng thái và sự kiện.
- Kết quả của cổng giả tính từ key, nên hai bản nhận cùng tỉ lệ từ chối và timeout. Trong số lần timeout, một nửa thực ra đã trừ tiền.
- Thời gian chờ cổng là 1 giây thay vì 10 giây của sơ đồ, để lượt đo gọn.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| Đơn lệch giữa 3 database sau 10.000 đơn (5 % bị từ chối, 2 % timeout) | vài chục mỗi tuần | 0 | Script đối soát: đơn hủy mà kho còn giữ; đơn hủy mà cổng giả có giao dịch thành công |
| Saga chạy tới trạng thái cuối sau khi kill orchestrator giữa chừng | không có cơ chế | 100 % | Test tích hợp `docker kill` ở bước ngẫu nhiên rồi khởi động lại |
| Thời gian từ `PaymentFailed` tới khi hàng được nhả | không xác định | p95 ≤ 5 giây | Timestamp trong `order_saga_transitions` |
| p95 `POST /orders` tới khi trả 202 | 2,5 giây (chờ cả quy trình) | ≤ 200 ms | k6 30 đơn/giây trong 5 phút |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** không còn khách bị trừ tiền cho đơn đã hủy; hàng bị giữ oan được nhả trong vài giây nên không mất doanh thu "hết hàng ảo"; đội vận hành bỏ được việc sửa dữ liệu mỗi sáng.

### 5.1 Số đã đo

**Môi trường** (đo ngày 2026-11-04): Apple M5, 10 nhân, 32 GB RAM, macOS (Darwin 25.6.0), chạy pin, mở nắp, không có khoảng ngủ ở cả bốn lượt. Docker Desktop 29.9.2, Compose v5.6.1, máy ảo Docker 10 CPU và 7,75 GiB RAM. PostgreSQL 16.15, PGMQ 1.13.0, service trên `node:20-alpine` (Node 20.20.2), k6 1.4.2 cùng mạng Compose. Load 1 phút của macOS: 2,7 – 3,9.

**Tải:** 30 đơn/giây trong 334 giây, khoảng 10.000 đơn mỗi lượt, cổng từ chối 5 % và timeout 2 %. Mỗi lượt `docker kill` tiến trình đặt hàng 3 lần rồi dựng lại sau 3 giây. Hai lượt mỗi bản, mốc kill khác nhau. Không rớt iteration nào.

| Chỉ số | Trước (`main`, `round-2`) | Sau (`main`, `round-2`) | Mục tiêu | Kết luận |
|---|---|---|---|---|
| Đơn lệch giữa ba nơi | 108/9.958, 108/9.937 | 0/9.953, 0/9.952 | 0 | Đạt |
| Saga tới trạng thái cuối sau khi kill orchestrator | 4 đơn treo mỗi lượt | 100 % ở cả hai lượt | 100 % | Đạt |
| Từ `PaymentFailed` tới khi hàng được nhả, p95 | không có cơ chế | 111,7 ms, 109,4 ms (lớn nhất 3.668,6 ms) | ≤ 5 giây | Đạt |
| p95 `POST /orders` | 36,2 ms, 39,7 ms | 5,3 ms, 5,4 ms | ≤ 200 ms | Đạt, nhưng bản trước cũng đạt |

**Chi tiết kết cục** (lượt `main`, lượt `round-2` trong ngoặc):

| | Trước | Sau |
|---|---|---|
| Đơn xác nhận | 9.248 (9.262) | 9.452 (9.440) |
| Đơn hủy | 706 (671) | 501 (512) |
| Đơn chưa kết thúc | 4 (4) | 0 (0) |
| Đơn hủy mà khách vẫn bị trừ tiền | 104 (104) | 0 (0) |
| Đơn treo đang giữ hàng | 4 (4) | 0 (0) |
| Đơn hủy mà kho còn giữ | 0 (0) | 0 (0) |
| Request không vào được lúc tiến trình bị kill | 66 (88) | 68 (69) |
| p99 `POST /orders` | 1.008,3 ms (1.008,7 ms) | 14,3 ms (12,9 ms) |
| Thời gian chờ saga cuối cùng kết thúc sau lượt tải | không áp dụng | 1.135 ms (1.689 ms) |

**Đọc số này thế nào**
- Bản sau chỉ hủy đúng phần cổng từ chối: khoảng 5 % đơn. Bản trước hủy khoảng 7 %, vì mọi lần timeout đều bị coi là thất bại. Trong đó khoảng một nửa khách đã bị trừ tiền (104 đơn), nửa còn lại là đơn lẽ ra bán được.
- Đơn treo của bản trước là các đơn đang chạy đúng lúc tiến trình bị kill. Bản sau gặp cùng 3 lần kill mà không có đơn nào treo, vì trạng thái nằm trong database chứ không nằm trong bộ nhớ của request.
- Cả hai bản đều mất khoảng 70 – 90 request lúc tiến trình bị kill, vì saga không làm API tự sống lại. Đây là số request nhận lỗi kết nối, không phải đơn lệch.
- Mục tiêu p95 `POST /orders` không phân biệt được hai bản, vì cổng giả chỉ trễ 20 ms. Ở p99 thì khác rõ: bản trước phải chờ hết 1 giây timeout, bản sau không chờ cổng.
- Giá trị lớn nhất 3.668,6 ms của bước nhả hàng là lúc lệnh rơi vào đúng khoảng consumer bị gián đoạn; p95 mới là con số đại diện. Nguyên nhân cụ thể chưa tách riêng được.
- Lượt đo không chạm tới hạn chót 15 phút, nên `VOIDING` và hoàn tiền chỉ được kiểm bằng test: số đơn hoàn tiền trong lượt đo là 0.

**Test:** 31/31 đạt trên PostgreSQL và PGMQ thật. `node scripts/kiem-chung-lab.mjs` đạt từ volume sạch.

**Phép thử âm** (`pnpm bench:drills`, số test đỏ trên số test của file bảo vệ phần đó):

| Gỡ phần nào của pattern | Test đỏ |
|---|---|
| Coi timeout là thất bại, không tra cứu cổng | 3/3 |
| Bước bù không idempotent | 1/5 |
| Bỏ tombstone của bước bù | 2/5 |
| Hết hạn thì nhả hàng ngay dù chưa chốt với cổng | 3/5 |
| Không có hạn chót khi còn giữ hàng | 1/5 |
| Gửi lệnh đầu tiên ngoài transaction tạo đơn | 3/3 |
| Hủy không hoàn tiền | 1/5 |

**Hạn chế:** ba schema chung một PostgreSQL nên bài chưa đụng vấn đề gửi message khi tách máy chủ. Mỗi dịch vụ một instance. Hai lượt mỗi bản. Chạy pin, cùng nguồn điện ở cả bốn lượt. Tồn kho rất lớn nên không có đơn hết hàng trong lượt đo; trường hợp này chỉ kiểm bằng test.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Thiếu cô lập: người khác có thể thấy trạng thái trung gian; phải thiết kế countermeasure và giao diện "đang xử lý". Nhất quán sau cùng thay cho nhất quán tức thì: nghiệp vụ chấp nhận vài giây "chưa biết".
- Lượng code và test tăng mạnh: mỗi bước cần bước bù, mỗi bước bù cần test lỗi; orchestrator là thêm một thành phần phải theo dõi.

**Không nên dùng khi**
- Các bước nằm trong một database: dùng transaction thường.
- Chỉ có hai bước và bù đơn giản: outbox + idempotent consumer là đủ; đội chưa có hai thứ đó chạy ổn thì saga dựng trên nền lỏng sẽ lệch dữ liệu theo cách khó tìm hơn.
- Không có bước bù có nghĩa cho một bước giữa chuỗi: xem lại thứ tự bước hoặc ranh giới service trước.

**Liên quan**
- Đọc trước: `../../14-backend-queueing/03-transactional-outbox-ghi-don-xong-crash-mat-event/`, `../../14-backend-queueing/04-idempotent-consumer-event-den-hai-lan-tru-kho-hai-lan/`, `../02-database-per-service-hai-service-cung-sua-mot-bang/`.
- Dùng trong bài: `../../14-backend-queueing/05-dead-letter-queue-mot-message-loi-chan-ca-hang-doi/`, `../../14-backend-queueing/07-delayed-message-huy-don-chua-thanh-toan-sau-15-phut/`, `../../01-frontend-backend-transporter/03-idempotency-key-bam-thanh-toan-hai-lan/`; quan sát: `../../23-backend-monitoring-benchmark/03-distributed-tracing-otel-request-qua-6-service-cham-o-dau/`.

## 7. Cơ sở tham khảo

- Hector Garcia-Molina & Kenneth Salem, "Sagas", SIGMOD 1987 — định nghĩa gốc: chuỗi transaction có bước bù thay cho transaction dài.
- Chris Richardson, "Pattern: Saga", microservices.io — https://microservices.io/patterns/data/saga.html — choreography và orchestration, vấn đề cập nhật trạng thái và gửi message nguyên tử.
- Chris Richardson, *Microservices Patterns*, Manning, 2018, chương 4 về quản lý transaction bằng saga — phân loại compensatable / pivot / retriable, thiếu cô lập và các countermeasure như semantic lock.
- Microsoft Azure Architecture Center, "Compensating Transaction pattern" — https://learn.microsoft.com/azure/architecture/patterns/compensating-transaction — bước bù phải idempotent, có thể thất bại và cần retry.
- Temporal docs — https://docs.temporal.io/ — workflow bền vững, activity retry, timer cho bước so sánh.

## 8. Kế hoạch thực hành

- [x] Bước 1: dựng 3 service tối giản và cổng thanh toán giả; phiên bản "trước" gọi HTTP tuần tự với try/catch hoàn kho.
- [x] Bước 2: đo "trước": 10.000 đơn với 5 % từ chối, 2 % timeout, kill `order-service` ngẫu nhiên 3 lần; chạy script đối soát, ghi số đơn lệch.
- [x] Bước 3: viết orchestrator, bảng `order_sagas`, ba hàng đợi PGMQ, handler idempotent, tra cứu khi timeout, hạn 15 phút bằng message trễ.
- [x] Bước 4: đo "sau" cùng kịch bản, ghi số thật và môi trường vào mục 5. *(Phần tùy chọn Temporal không làm.)*
- [x] Bước 5: test: (a) thanh toán bị từ chối thì hàng được nhả và đơn hủy; (b) timeout dẫn tới tra cứu, không bù khi cổng báo thành công; (c) kill orchestrator giữa chừng, saga vẫn kết thúc đúng; (d) `ReleaseStock` hai lần chỉ nhả một lần.

**Cấu trúc code**
```text
apps/
  truoc/truoc.module.ts              # HTTP tuần tự, try/catch hoàn kho, coi timeout là thất bại
  order-service/
    saga-machine.ts                  # [PATTERN] toàn bộ quy tắc saga, hàm thuần
    order-service.module.ts          # [PATTERN] orchestrator: đổi trạng thái và gửi lệnh cùng transaction
  inventory-service/                 # [PATTERN] ReserveStock, ReleaseStock idempotent, tombstone
  payment-service/
    gateway.client.ts                # [PATTERN] timeout thì tra cứu, chỉ từ chối khi cổng xác nhận
    payment-service.module.ts        # Charge, Void; key là mã saga
  fake-gateway/                      # idempotency key, tra cứu, hủy, chế độ timeout và từ chối
libs/
  platform/queue.ts                  # đọc PGMQ; handler tự archive trong transaction của nó
  reconcile.ts                       # đối soát đơn, kho và sổ cái của cổng
db/init/                             # role, hàng đợi, schema, seed
test/
  saga-machine.test.ts
  payment-failure-releases-stock.test.ts
  payment-timeout-queries-before-compensating.test.ts
  orchestrator-crash-resumes-saga.test.ts
  compensation-is-idempotent.test.ts
  deadline-settles-before-releasing.test.ts
bench/
  place-orders.k6.js
  run-orders.ts                      # đo một bản: tải, kill tiến trình, đối soát
  show-results.mjs
  negative-drills.ts
docker-compose.yml                   # postgres; profile truoc, sau, bench
```

**Cách chạy** *(chỉ cần Docker; k6 chạy trong container)*
```bash
pnpm install                 # tự gói dist/*.cjs
docker compose up -d --wait  # chỉ dựng PostgreSQL có PGMQ
pnpm typecheck && pnpm test
pnpm bench:drills            # phép thử âm, cần PostgreSQL đang chạy, khoảng 5 phút
docker compose down -v

# Đo hai bản, mỗi lệnh khoảng 6 phút và tự dọn sau khi xong; đừng gập nắp máy trong lúc đo
pnpm bench:orders --variant truoc --run main
pnpm bench:orders --variant sau --run main
pnpm bench:show main
```

## Bài học sau khi làm

- Saga xóa được cả hai loại đơn lệch: 108 đơn ở bản trước, 0 ở bản sau, dù tiến trình bị kill 3 lần mỗi lượt. Thứ làm nên khác biệt là trạng thái bền và việc gửi lệnh cùng transaction, không phải bản thân message.
- Lỗi đắt nhất của bản trước là coi timeout là thất bại: 104 khách mất tiền cho đơn đã hủy, gấp 26 lần số đơn do crash.
- Thiết kế ban đầu của bài có lỗi: hết hạn thì bù ngay, không có bước hoàn tiền, và `RESERVING` có thể kẹt. Sửa bằng `VOIDING`, `VoidPayment` và hạn chót cho mọi trạng thái. Viết máy trạng thái thành bảng thuần giúp thấy các đường còn thiếu.
- Một race thật được phát hiện khi đọc lại code, trước lúc chạy: bù song song với giữ hàng làm hàng bị giữ vĩnh viễn. Test chạy song song 60 saga giữ cho lỗi này không quay lại.
- Saga không làm API sống dậy: cả hai bản đều mất 66 – 88 request lúc kill. Khác biệt nằm ở chỗ đơn đã nhận thì không bao giờ bị bỏ dở.
- Hạn chế lớn nhất: ba schema chung một PostgreSQL. Bài dựa vào `pgmq.send` cùng transaction, nên tách máy chủ thì phải có Outbox (14/03) và idempotent consumer (14/04) đầy đủ.
- Tên file trong `bench/` không được bắt đầu bằng `results`: `kiem-chung-lab.mjs` coi đó là file kết quả thô và chặn commit.
