# Circuit Breaker — Service khuyến mãi chậm 30 giây kéo sập toàn bộ checkout

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 07 · backend / microservices | 🟡 Trung bình | ✅ Hoàn thành | Circuit Breaker — Nygard, *Release It!* (2007/2018) | 2026-11-04 |

> **Một câu tóm tắt:** Bọc lời gọi sang service khuyến mãi bằng một "cầu dao": khi lỗi hoặc timeout vượt ngưỡng, cầu dao mở và checkout trả lời ngay bằng phương án dự phòng (không giảm giá) thay vì chờ 30 giây và kéo cạn tài nguyên của chính mình.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
Sàn thương mại điện tử, khoảng 1.500 lượt checkout/phút giờ cao điểm. `checkout-service` gọi đồng bộ `promotion-service` để tính giảm giá cho mỗi giỏ hàng, kể cả giỏ không có mã khuyến mãi. `promotion-service` đọc PostgreSQL riêng; trong chiến dịch lớn, một truy vấn kiểm tra điều kiện mã bị chậm vì thiếu index.

**Triệu chứng người kinh doanh nhìn thấy**
- Trong 25 phút, gần như không có đơn nào hoàn tất; doanh thu buổi tối về 0 dù chỉ phần "khuyến mãi" có vấn đề.
- Khách thấy nút "Thanh toán" quay 30 giây rồi lỗi; nhiều người bấm lại, tải tăng thêm.
- Đội vận hành phải khởi động lại `checkout-service` ba lần; mỗi lần đỡ được vài phút rồi lại treo.

**Nguyên nhân kỹ thuật**
Mỗi lời gọi tới `promotion-service` chờ đủ 30 giây timeout. Ở 1.500 request/phút, số kết nối chờ trong `checkout-service` tăng tới giới hạn pool HTTP và pool database chỉ sau vài chục giây; mọi request mới — kể cả giỏ không cần khuyến mãi — xếp hàng chờ tài nguyên và cũng timeout. Lỗi ở một phụ thuộc không quan trọng lan thành lỗi toàn phần ở service quan trọng: đây là *cascading failure*, và các lời gọi liên tục đổ vào `promotion-service` còn cản nó tự hồi phục.

**Ràng buộc**
- Nghiệp vụ chấp nhận checkout tạm *không áp dụng khuyến mãi* trong vài phút, kèm thông báo rõ cho khách; không chấp nhận checkout thất bại.
- Không được sửa `promotion-service` trong bài này (đội khác sở hữu); giải pháp nằm ở phía gọi.
- Phải quan sát được trạng thái cầu dao để vận hành biết khi nào đang chạy chế độ dự phòng.

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** phía gọi tiếp tục gọi và chờ một phụ thuộc đã hỏng, tiêu hết tài nguyên của mình và không cho phụ thuộc thời gian hồi phục.

**Pattern giải quyết thế nào:** Nygard mô tả Circuit Breaker như cầu dao điện. Bình thường cầu dao *đóng* (Closed): lời gọi đi qua, bộ đếm theo dõi lỗi và timeout trong cửa sổ gần nhất. Vượt ngưỡng, cầu dao *mở* (Open): mọi lời gọi bị từ chối ngay lập tức, không tốn kết nối, không chờ; checkout dùng phương án dự phòng. Sau một khoảng nghỉ, cầu dao *hé mở* (Half-Open): cho một vài lời gọi thử đi qua; thành công thì đóng lại, thất bại thì mở tiếp. Fowler nhấn mạnh phần thường bị bỏ quên: mọi lần đổi trạng thái phải được ghi log và đo, vì cầu dao mở là tín hiệu vận hành quan trọng. Pattern luôn đi cùng timeout ngắn (bài 04): không có timeout thì không có "lỗi" để đếm.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (thêm index ở promotion, tăng pool ở checkout) | Hết sự cố lần này | Không sửa được ở phía gọi; phụ thuộc kế tiếp chậm sẽ lặp lại đúng kịch bản; không được sửa promotion theo ràng buộc |
| Chỉ đặt timeout ngắn (2 giây) | Giảm thời gian treo mỗi request | Cần nhưng chưa đủ: mỗi request vẫn chờ 2 giây và vẫn đổ tải vào service đang hỏng |
| Retry khi lỗi | Vượt qua lỗi thoáng qua | Làm tình hình tệ hơn khi phụ thuộc đang quá tải (bài 04) |
| Bulkhead: pool riêng cho lời gọi promotion (bài 08) | Cách ly tài nguyên, checkout không cạn pool | Bổ trợ tốt; nhưng request vẫn chờ timeout, không có fail-fast và dự phòng |
| Tính khuyến mãi bất đồng bộ hoặc cache sẵn | Bỏ hẳn lời gọi đồng bộ | Thay đổi nghiệp vụ (giá hiển thị có thể lệch); để làm sau khi đã có cầu dao |
| Circuit Breaker + timeout + fallback (chọn) | Fail-fast, giữ checkout sống, cho promotion thời gian hồi phục, quan sát được | Thêm một trạng thái phải vận hành; cần chọn ngưỡng đúng |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước"]
    direction LR
    C1["checkout-service<br/>pool HTTP và DB cạn"]:::loi
    P1["promotion-service<br/>chậm 30 giây"]:::loi
    C1 -->|"chờ đủ timeout"| P1
  end

  subgraph SAU["Sau"]
    direction LR
    C2["checkout-service"]:::cu
    CB["Circuit Breaker<br/>timeout 2 giây, ngưỡng lỗi, nghỉ 30 giây"]:::moi
    FB["Fallback<br/>giỏ hàng không giảm giá"]:::moi
    P2["promotion-service"]:::cu
    M["Prometheus<br/>trạng thái cầu dao, số lần mở"]:::moi
    C2 --> CB -->|"đóng hoặc hé mở"| P2
    CB -->|"mở"| FB
    CB -.-> M
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  participant KH as Khách hàng
  participant CK as checkout-service
  participant CB as Circuit Breaker
  participant PR as promotion-service
  KH->>CK: Thanh toán giỏ hàng
  CK->>CB: Tính giảm giá
  CB->>PR: Gọi với timeout 2 giây
  PR--xCB: Timeout
  CB-->>CK: Lỗi, dùng fallback
  CK-->>KH: Đơn tạo xong, khuyến mãi tạm không áp dụng
  Note over CB: Tỷ lệ lỗi trong 10 giây vượt 50 %, cầu dao chuyển sang Open
  KH->>CK: Khách khác thanh toán
  CK->>CB: Tính giảm giá
  CB-->>CK: Từ chối ngay, không gọi promotion
  CK-->>KH: Đơn tạo xong trong 120 ms
  Note over CB: Hết 30 giây nghỉ, chuyển sang Half-Open
  CK->>CB: Tính giảm giá
  CB->>PR: Một lời gọi thử
  alt Thành công
    PR-->>CB: Kết quả giảm giá
    Note over CB: Đóng lại, lưu lượng bình thường
  else Vẫn lỗi
    PR--xCB: Timeout
    Note over CB: Mở tiếp thêm 30 giây
  end
```

### 3.3 Vòng đời cầu dao

```mermaid
stateDiagram-v2
  [*] --> Closed
  Closed --> Open : lỗi hoặc timeout vượt ngưỡng trong cửa sổ
  Open --> HalfOpen : hết thời gian nghỉ
  HalfOpen --> Closed : lời gọi thử thành công
  HalfOpen --> Open : lời gọi thử thất bại
  Closed --> Closed : thành công, đặt lại bộ đếm
```

### 3.4 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| Circuit Breaker (một instance cho mỗi phụ thuộc) | Đếm lỗi theo cửa sổ, chuyển trạng thái, từ chối nhanh khi mở | Ngưỡng theo *tỷ lệ* lỗi kèm số request tối thiểu, tránh mở vì 1 lỗi lúc tải thấp |
| Timeout 2 giây | Biến "chậm" thành "lỗi" để cầu dao đếm được | Đặt theo p99 bình thường của promotion nhân khoảng 2–3 |
| Fallback | Trả giỏ hàng không giảm giá, gắn cờ `promotionUnavailable` | Nghiệp vụ duyệt trước; giao diện hiển thị thông báo, không im lặng |
| Metrics và log | Phơi trạng thái cầu dao, số lần mở, số lần dùng fallback | Cảnh báo khi cầu dao mở quá 2 phút hoặc tỷ lệ fallback cao |
| k6 + công cụ tiêm lỗi | Tái hiện promotion chậm 30 giây có kiểm soát | Tiêm độ trễ ở tầng mạng để không phải sửa code promotion |

### 3.5 Điểm dễ sai khi triển khai
- **Không có timeout.** Cầu dao chỉ đếm lỗi; lời gọi treo vô hạn không bao giờ thành lỗi. Timeout là điều kiện tiên quyết.
- **Ngưỡng theo số tuyệt đối.** "5 lỗi thì mở" sẽ mở nhầm lúc nửa đêm tải thấp. Dùng tỷ lệ lỗi trong cửa sổ kèm số request tối thiểu.
- **Một cầu dao cho mọi phụ thuộc.** Payment lỗi làm cầu dao của promotion mở theo. Mỗi phụ thuộc, mỗi cầu dao.
- **Fallback gọi lại chính phụ thuộc đang hỏng** hoặc gọi một phụ thuộc khác chưa được bảo vệ. Fallback phải rẻ và cục bộ.
- **Trạng thái cầu dao ở từng instance** của checkout: 10 instance là 10 cầu dao độc lập, mở không cùng lúc. Chấp nhận được, nhưng dashboard phải tổng hợp theo instance.
- **Không test chế độ Half-Open.** Lỗi hay gặp là cho quá nhiều lời gọi thử đi qua cùng lúc, tạo đợt tải mới lên service vừa hồi phục.
- **Dùng timeout của thư viện cầu dao mà không hủy lời gọi.** Timeout của `opossum` chỉ làm hàm trả lỗi, kết nối vẫn bị giữ tới khi phía kia trả lời. Lab tắt timeout đó và dùng `AbortSignal` ở lời gọi HTTP, để timeout trả kết nối về pool.
- **Tin rằng pool nhỏ sẽ che chắn được phụ thuộc.** Bản "trước" chỉ có 50 kết nối nhưng promotion vẫn nhận 1.363,7 lời gọi/phút lúc sự cố: timeout tính cả thời gian xếp hàng, nên request vào tới kết nối thì sắp hết giờ, bị hủy và nhường chỗ cho request sau. Pool chỉ giới hạn số lời gọi cùng lúc, không giới hạn lưu lượng.

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ngôn ngữ, ứng dụng | TypeScript strict, NestJS cho hai service | Trùng stack repo; interceptor của NestJS gói lời gọi gọn | Fastify |
| Circuit breaker | `opossum` | Thư viện Node.js chuyên cho pattern này: trạng thái, ngưỡng theo tỷ lệ, fallback, sự kiện để đo | `cockatiel` (có cả retry, timeout, bulkhead), tự viết khoảng 100 dòng |
| HTTP client | `undici` với timeout tường minh | Timeout headers và body tách bạch, mặc định của Node | axios |
| Tiêm lỗi | Toxiproxy | Thêm độ trễ 30 giây giữa hai container mà không sửa code promotion | `tc netem`, cờ chậm trong code promotion |
| Đo | Prometheus + `prom-client`, k6 | Gauge trạng thái cầu dao, counter số lần mở và số fallback; k6 đo p99 checkout | Grafana để vẽ |
| Hạ tầng local | Docker Compose | Dựng hai service, Toxiproxy, Prometheus | — |

**Thay đổi so với hệ thống hiện tại:** thêm một lớp bọc lời gọi ở checkout, một fallback đã được nghiệp vụ duyệt, ba metric mới và một cảnh báo; đội vận hành phải hiểu ba trạng thái cầu dao và biết đọc dashboard để trả lời "có đang chạy chế độ không khuyến mãi không".

**Ghi chú khi làm lab**
- Phiên bản: NestJS 10.4.22, `opossum` 9.0.0, `undici` 7.30.1, `prom-client` 15.1.3, Toxiproxy 2.12.0, Prometheus 3.14.0, k6 1.4.2. `opossum` 10 và `undici` 8 đòi Node ≥ 22 nên lab trên Node 20 ghim hai bản trên.
- Bài không có database: mục 1 nhắc cả pool database, còn lab chỉ tái hiện pool HTTP của checkout, theo cấu trúc `docker-compose.yml` ở mục 8.
- Lời gọi được bọc ở `GuardedPromotionClient`, không dùng interceptor của NestJS: interceptor bọc request đi vào, còn đây là lời gọi đi ra.
- Một app checkout chạy cả hai bản, `CHECKOUT_MODE` chọn client. Mọi thứ khác giống nhau.
- Độ trễ đặt ở chiều promotion trả về, nên request vẫn tới promotion và bộ đếm của nó thấy đúng lưu lượng.
- Không dựng cảnh báo và Grafana: lab kiểm metric tới được Prometheus bằng truy vấn trực tiếp.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| p99 checkout khi promotion chậm 30 giây | 30.000 ms | ≤ 500 ms sau khi cầu dao mở | k6 25 request/giây trong 5 phút, Toxiproxy thêm độ trễ 30 giây ở phút thứ 1 |
| Tỷ lệ checkout thành công trong sự cố | ≈ 0 % | ≥ 99 % (ở dạng không giảm giá) | k6 `checks` theo mã trả về và cờ `promotionUnavailable` |
| Thời gian từ khi promotion hỏng tới khi cầu dao mở | không có | ≤ 10 giây | Log đổi trạng thái có timestamp, so với thời điểm bật Toxiproxy |
| Số lời gọi tới promotion trong khi cầu dao mở | 1.500/phút | chỉ lời gọi thử ở Half-Open | Counter request ở promotion, hoặc log Toxiproxy |
| Thời gian hồi phục sau khi promotion khỏe lại | phải khởi động lại checkout | ≤ 1 chu kỳ nghỉ, 30 giây | Log chuyển Half-Open sang Closed |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** sự cố ở khuyến mãi chỉ làm mất phần giảm giá trong vài phút thay vì mất toàn bộ doanh thu checkout; đội vận hành thấy ngay dịch vụ nào đang bị ngắt.

### 5.1 Số đã đo

**Môi trường** (đo ngày 2026-11-04, lượt `main-2`): Apple M5, 10 nhân, 32 GB RAM, macOS (Darwin 25.6.0), chạy pin, mở nắp, không có khoảng ngủ. Docker Desktop 29.9.2, Compose v5.6.1, máy ảo Docker 10 CPU và 7,75 GiB RAM. Service trên `node:20-alpine` (Node 20.20.2), k6 1.4.2 cùng mạng Compose. Load 1 phút của macOS: 1,9 – 2,9.

**Tải:** mô hình mở 25 request/giây trong 5 phút, không rớt iteration nào. Toxiproxy thêm độ trễ 30 giây từ phút thứ 1 tới phút thứ 4. "Sau khi cầu dao mở" là các request bắt đầu từ giây thứ 15 của sự cố. Giỏ hàng trong lượt tải không có mã khuyến mãi.

| Chỉ số | Trước | Sau | Mục tiêu | Kết luận |
|---|---|---|---|---|
| p99 checkout khi promotion chậm 30 giây | 30.006,7 ms | 3,0 ms sau khi cầu dao mở; 2.004,2 ms tính cả lúc chưa mở | ≤ 500 ms sau khi cầu dao mở | Đạt |
| Tỷ lệ checkout thành công trong sự cố | 16,7 % (751/4.500) | 100 % (4.500/4.500), 4.499 đơn ở dạng không giảm giá | ≥ 99 % | Đạt |
| Thời gian từ khi promotion hỏng tới khi cầu dao mở | không có | 6,7 giây | ≤ 10 giây | Đạt |
| Số lời gọi tới promotion trong khi cầu dao mở | 1.363,7/phút | 1,8/phút | chỉ lời gọi thử | Đạt |
| Thời gian hồi phục sau khi promotion khỏe lại | tự hết khi gỡ độ trễ, không cần khởi động lại | 16,9 giây | ≤ 30 giây | Đạt |

**Độ trễ chi tiết** (đơn vị ms):

| Giai đoạn | Bản | Thành công / lỗi | p50 | p95 | p99 | Lớn nhất |
|---|---|---|---|---|---|---|
| Trước sự cố (60 giây) | Trước | 1.500 / 0 | 3,6 | 5,2 | 7,9 | 29,4 |
| Trước sự cố (60 giây) | Sau | 1.500 / 0 | 3,9 | 5,6 | 7,1 | 20,2 |
| Sự cố (180 giây) | Trước | 751 / 3.749 | 30.002,9 | 30.005,5 | 30.006,7 | 30.016,5 |
| Sự cố (180 giây) | Sau | 4.500 / 0 | 1,6 | 2,8 | 2.004,2 | 2.015,7 |
| Sự cố, từ giây thứ 15 | Sau | 4.125 / 0 | 1,6 | 2,3 | 3,0 | 2.006,2 |
| Sau sự cố (60 giây) | Trước | 1.501 / 0 | 3,5 | 4,7 | 5,9 | 151,1 |
| Sau sự cố (60 giây) | Sau | 1.500 / 0 | 2,6 | 3,8 | 4,4 | 9,3 |

**Đọc số này thế nào**
- Ở bản trước, 751 đơn thành công khớp với lượng đơn vào trong 30 giây cuối sự cố (25 × 30 = 750): chúng đang chờ thì độ trễ được gỡ. Suy ra gần như không có đơn nào hoàn tất trước đó, nhưng lab không ghi từng request nên chưa kiểm được trực tiếp.
- Bản sau chưa mở cầu dao trong 6,7 giây đầu, nên những request đó chờ đủ timeout 2 giây. Cầu dao không mở ngay vì cửa sổ 10 giây còn nhiều lời gọi thành công từ trước sự cố, và lỗi chỉ được đếm sau 2 giây timeout.
- Giá trị lớn nhất 2.006,2 ms lúc cầu dao đã mở là lời gọi thử ở Half-Open. Cầu dao đổi trạng thái theo đúng chu kỳ: mở 30 giây, thử 2 giây, mở lại, tổng cộng 6 lần thử.
- Thời gian hồi phục tùy lúc promotion khỏe lại rơi vào đâu trong chu kỳ 30 giây. Trong 16,9 giây đó, 422 đơn vẫn dùng fallback dù promotion đã khỏe: đây là cái giá của thời gian nghỉ.
- Bản trước không cần khởi động lại, khác số minh họa ở mục 1, vì checkout của lab không giữ tài nguyên nào khác ngoài pool HTTP.

**Test:** 15/15 đạt, không cần Docker. `node scripts/kiem-chung-lab.mjs` đạt 6/6 bước từ đầu. Đã kiểm trực tiếp trên Compose: `circuit_breaker_state`, `circuit_breaker_opened_total` và `promotion_requests_total` tới được Prometheus.

**Phép thử âm** (`pnpm bench:drills`, số test đỏ trên số test của file bảo vệ phần đó):

| Gỡ phần nào của pattern | Test đỏ |
|---|---|
| Đếm cả lỗi do request sai vào ngưỡng | 2/3 |
| Bỏ số lời gọi tối thiểu | 1/6 |
| Bỏ fallback | 4/6 |
| Cầu dao không bao giờ thử lại | 3/3 |
| Bỏ timeout của lời gọi | 2/3 |

**Hạn chế:** mỗi bản một lượt 5 phút và không chạy nhiều vòng, vì chênh lệch lớn hơn nhiễu nhiều bậc. Một instance checkout, nên chưa thấy nhiều cầu dao mở không cùng lúc. Chạy pin, cùng nguồn điện cho cả hai bản. Lượt `main` đầu tiên bị bỏ vì máy gập nắp và ngủ từ 12:14:44 tới 12:26:40; README không dùng số nào từ lượt đó.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Fallback là một hành vi nghiệp vụ mới (khách không được giảm giá dù có mã) — cần thỏa thuận trước và hiển thị minh bạch.
- Ngưỡng và thời gian nghỉ là tham số phải chỉnh theo thực tế; đặt sai gây mở nhầm hoặc mở quá muộn.
- Thêm trạng thái trong tiến trình; với nhiều instance, hành vi không đồng nhất tức thời.

**Không nên dùng khi**
- Phụ thuộc là *bắt buộc* và không có fallback có nghĩa (ví dụ xác nhận thanh toán): cầu dao mở chỉ đổi cách thất bại; khi đó cần bulkhead, timeout và hàng đợi hơn.
- Lời gọi hiếm (vài lần một phút): bộ đếm không đủ mẫu, cầu dao gần như vô dụng; chỉ cần timeout.
- Lỗi do chính request sai (400) chứ không do phụ thuộc hỏng: không được đếm vào ngưỡng, nếu không một client gửi sai sẽ mở cầu dao cho tất cả.

**Liên quan**
- Đọc trước: `../04-timeout-retry-backoff-jitter-retry-dong-loat-tao-bao-moi/` — timeout là tiền đề của cầu dao.
- Đọc sau: `../08-bulkhead-mot-tenant-lon-chiem-het-thread-pool/` — cách ly tài nguyên bổ trợ cho fail-fast.
- Cùng chủ đề: `../../18-backend-scale/05-load-shedding-qua-tai-thi-tu-choi-mot-phan-thay-vi-sap-het/` — từ chối có chủ đích ở phía nhận; `../../23-backend-monitoring-benchmark/06-alerting-symptom-not-cause-50-alert-moi-dem-khong-ai-doc/` — cảnh báo khi cầu dao mở.

## 7. Cơ sở tham khảo

- Michael Nygard, *Release It!*, 2nd ed., Pragmatic Bookshelf, 2018 — phần Stability Patterns: Circuit Breaker, Timeouts, Fail Fast; mô tả cascading failure và vì sao cầu dao bảo vệ cả phía gọi lẫn phía được gọi.
- Martin Fowler, "CircuitBreaker", bliki, 2014 — https://martinfowler.com/bliki/CircuitBreaker.html — ba trạng thái Closed/Open/Half-Open, ví dụ code và nhấn mạnh việc giám sát đổi trạng thái.
- Microsoft Azure Architecture Center, "Circuit Breaker pattern" — https://learn.microsoft.com/azure/architecture/patterns/circuit-breaker — các vấn đề cần cân nhắc: ngưỡng, ghi log, kiểm tra thủ công, phân loại lỗi.
- opossum — https://github.com/nodeshift/opossum — thư viện circuit breaker cho Node.js dùng ở mục 4, tài liệu tham số và sự kiện.
- Prometheus docs — https://prometheus.io/docs/ — cách phơi gauge và counter cho trạng thái cầu dao.

## 8. Kế hoạch thực hành

- [x] Bước 1: dựng `checkout-service` gọi `promotion-service` qua Toxiproxy; Docker Compose kèm Prometheus; k6 kịch bản 25 request/giây.
- [x] Bước 2: đo "trước": bật độ trễ 30 giây ở Toxiproxy ở phút thứ 1, ghi p99 và tỷ lệ thành công checkout trong 5 phút.
- [x] Bước 3: bọc lời gọi bằng `opossum` với timeout 2 giây, ngưỡng tỷ lệ lỗi 50 % trên tối thiểu 10 request trong 10 giây, nghỉ 30 giây; thêm fallback và metric.
- [x] Bước 4: đo "sau" cùng kịch bản; ghi số thật và môi trường vào mục 5. *(Không chụp dashboard: lab không dựng Grafana, trạng thái cầu dao đọc từ log và Prometheus.)*
- [x] Bước 5: test: (a) sau N lỗi cầu dao mở và lời gọi tiếp theo không chạm promotion; (b) hết thời gian nghỉ chỉ một lời gọi thử đi qua; (c) lỗi 400 không làm mở cầu dao; (d) fallback trả giỏ hàng có cờ `promotionUnavailable`.

**Cấu trúc code**
```text
src/
  checkout/
    checkout.module.ts            # luồng thanh toán; CHECKOUT_MODE chọn client
    promotion.client.ts           # bản trước, và timeout bằng AbortSignal dùng chung
    guarded-promotion.client.ts   # [PATTERN] opossum, ngưỡng, fallback, đổi trạng thái
    metrics.ts                    # gauge trạng thái, counter mở và fallback
  promotion/                      # service của đội khác, không sửa
  shared/                         # log, correlation id, khởi động app
infra/                            # cấu hình Toxiproxy và Prometheus
test/
  opens-after-n-failures.test.ts
  half-open-allows-single-probe.test.ts
  client-error-does-not-open-breaker.test.ts
  slow-promotion-exhausts-pool.test.ts
bench/
  checkout-with-slow-promotion.k6.js
  run-slow-promotion.ts           # đo một bản: k6 chạy suốt, bật rồi gỡ độ trễ
  negative-drills.ts
docker-compose.yml                # checkout, promotion, toxiproxy, prometheus; k6 ở profile bench
```

**Cách chạy** *(test không cần Docker; lượt đo chỉ cần Docker, k6 chạy trong container)*
```bash
pnpm install                 # tự gói dist/*.cjs
pnpm typecheck && pnpm test
pnpm bench:drills            # phép thử âm

# Đo hai bản, mỗi lệnh khoảng 5 phút và tự dọn sau khi xong; đừng gập nắp máy trong lúc đo
pnpm bench:slow-promotion --variant truoc --run main
pnpm bench:slow-promotion --variant sau --run main
```

## Bài học sau khi làm

- Cầu dao giữ checkout sống và bảo vệ cả promotion: 4.500/4.500 đơn thành công thay vì 751/4.500, và lời gọi vào promotion giảm từ 1.363,7 xuống 1,8 mỗi phút. Giá phải trả là đơn không được giảm giá trong suốt sự cố, cộng 16,9 giây sau khi promotion đã khỏe.
- Chi tiết quyết định nhất không nằm ở cầu dao mà ở timeout: timeout phải hủy được lời gọi. Vì vậy lab tắt timeout của `opossum` và dùng `AbortSignal`. Phép thử âm bỏ timeout làm 2/3 test đỏ.
- Pool 50 kết nối không che chắn được promotion. Timeout tính cả lúc xếp hàng nên kết nối quay vòng ở đúng tốc độ request đi vào.
- Cầu dao mở sau 6,7 giây chứ không ngay lập tức. Đây là hệ quả của cửa sổ 10 giây và timeout 2 giây; muốn nhanh hơn thì rút ngắn hai số đó, đổi lại dễ mở nhầm.
- Lượt đo đầu mất vì máy gập nắp khi chạy pin; `caffeinate` không giữ được trong trường hợp này. Không có dòng log nào suốt 12 phút là dấu hiệu nhận ra, và `pmset -g log` xác nhận.
- `opossum` 10 và `undici` 8 đòi Node ≥ 22: tra `engines` trước khi ghim phiên bản cho lab trên Node 20.
