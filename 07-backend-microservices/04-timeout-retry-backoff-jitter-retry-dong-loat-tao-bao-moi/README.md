# Timeouts, Retries, Backoff with Jitter — Retry đồng loạt sau sự cố tạo cơn bão request thứ hai

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 07 · backend / microservices | 🟡 Trung bình | ✅ Hoàn thành | Exponential Backoff and Jitter — Marc Brooker, AWS (2015); Timeouts, retries, backoff — Amazon Builders' Library; Retry — Azure Cloud Design Patterns | 2026-11-04 |

> **Một câu tóm tắt:** Đặt timeout tường minh, chỉ retry có giới hạn cho thao tác an toàn, và giãn các lần retry theo cấp số nhân *cộng ngẫu nhiên* để hàng nghìn client không cùng gõ cửa đúng một thời điểm khi đối tác vừa hồi phục.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
Ví điện tử, khoảng 3.000 lượt nạp tiền/phút giờ cao điểm. `wallet-service` gọi API của đối tác ngân hàng để xác nhận nạp tiền. HTTP client dùng timeout mặc định của thư viện (không giới hạn với một số thao tác) và retry 3 lần, cách nhau cố định 1 giây, cho mọi loại lỗi.

**Triệu chứng người kinh doanh nhìn thấy**
- Đối tác ngân hàng gặp sự cố 20 giây; phía ví điện tử mất 25 phút mới hồi phục, dù đối tác đã khỏe lại từ lâu.
- Khách thấy "đang xử lý" rồi lỗi, bấm lại; tổng đài nhận 400 cuộc gọi trong một giờ về nạp tiền chưa vào ví.
- Một số giao dịch được đối tác ghi nhận hai lần vì request đầu thực ra đã thành công nhưng phản hồi về trễ, hệ thống retry và nạp lại.

**Nguyên nhân kỹ thuật**
Ba lỗi cộng dồn. (1) Không có timeout: kết nối treo giữ tài nguyên của `wallet-service` hàng chục giây. (2) Retry cố định và đồng bộ: 3.000 request thất bại cùng lúc đều retry sau đúng 1 giây, tạo một đợt tải gấp 3–4 lần bình thường đổ vào đối tác đúng lúc nó vừa hồi phục, làm nó ngã lần nữa — "cơn bão request thứ hai", lặp lại nhiều chu kỳ. (3) Retry thao tác không idempotent: cùng một lệnh nạp tiền được gửi lại mà không có khóa chống trùng.

**Ràng buộc**
- Không kiểm soát được phía đối tác; chỉ sửa được phía gọi.
- Nghiệp vụ cho phép trả "đang xử lý" và hoàn tất sau bằng đối soát, nhưng không cho phép nạp trùng.
- Độ trễ chấp nhận cho một lần nạp là 5 giây ở p99 trong điều kiện bình thường.

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** phía gọi phản ứng với sự cố theo cách *đồng bộ và không giới hạn*: chờ vô hạn, retry cùng nhịp, retry mọi thứ.

**Pattern giải quyết thế nào:** Bộ ba kỹ thuật được Amazon Builders' Library mô tả cùng nhau. *Timeout* biến "chậm vô hạn" thành lỗi có giới hạn, giải phóng tài nguyên. *Retry có giới hạn* chỉ dành cho lỗi thoáng qua và thao tác idempotent, với *ngân sách retry* để tổng lượng retry không vượt một phần nhỏ lưu lượng. *Exponential backoff* giãn các lần thử (1, 2, 4, 8 giây) để giảm tải lên phụ thuộc đang yếu; nhưng Brooker chỉ ra rằng backoff thuần vẫn làm các client thử lại *cùng thời điểm*, nên cần *jitter*: thêm ngẫu nhiên vào thời gian chờ. Phương án "Full Jitter" — chờ ngẫu nhiên trong khoảng từ 0 tới giới hạn backoff hiện tại — trong mô phỏng của Brooker giảm cả tổng số lần gọi lẫn thời gian hoàn tất so với backoff không jitter. Kết hợp với Idempotency Key (`01` bài 03) để retry thao tác ghi an toàn.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (tăng timeout, thêm instance wallet) | Chịu được lâu hơn trước khi cạn tài nguyên | Không đổi hình dạng đợt retry; thêm instance nghĩa là bão lớn hơn |
| Bỏ hẳn retry | Hết bão retry | Lỗi thoáng qua vài phần trăm trở thành lỗi người dùng; đối tác thường có lỗi lẻ |
| Retry cố định nhanh hơn | Hồi phục nhanh với lỗi rất ngắn | Chính là nguyên nhân của bão; tệ hơn ở sự cố dài |
| Circuit Breaker (bài 03) | Ngừng gọi hẳn khi đối tác hỏng lâu | Bổ trợ, không thay thế: cầu dao không giải quyết lỗi lẻ và không giãn retry |
| Chuyển sang xử lý bất đồng bộ qua hàng đợi (`13` bài 05) | Tách người dùng khỏi độ trễ đối tác | Đổi trải nghiệm người dùng; làm sau khi đã có timeout/retry đúng ở worker |
| Timeout + retry giới hạn + backoff với jitter + idempotency (chọn) | Giải quyết đủ ba nguyên nhân với thay đổi khoanh vùng ở client | Phải chọn tham số và phân loại lỗi cẩn thận |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước"]
    direction LR
    W1["wallet-service<br/>3.000 client logic"]:::cu
    R1["Retry cố định 1 giây x3<br/>không timeout, retry mọi lỗi"]:::loi
    B1["API đối tác<br/>vừa hồi phục đã nhận tải gấp 3"]:::loi
    W1 --> R1 --> B1
  end

  subgraph SAU["Sau"]
    direction LR
    W2["wallet-service"]:::cu
    IK["Idempotency-Key<br/>cho mỗi lệnh nạp"]:::moi
    TO["Timeout<br/>kết nối 1 giây, phản hồi 3 giây"]:::moi
    RT["Retry có ngân sách<br/>tối đa 3 lần, chỉ lỗi thoáng qua"]:::moi
    BJ["Backoff + Full Jitter<br/>ngẫu nhiên trong 0..min(cap, base x 2^n)"]:::moi
    B2["API đối tác"]:::cu
    W2 --> IK --> TO --> RT --> BJ --> B2
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  participant KH as Khách hàng
  participant W as wallet-service
  participant P as Chính sách retry
  participant B as API đối tác
  KH->>W: Nạp 500.000 đồng
  W->>W: Sinh Idempotency-Key cho lệnh nạp
  W->>P: Gọi đối tác với key
  P->>B: Lần 1, timeout 3 giây
  B--xP: Timeout
  P->>P: Lỗi thoáng qua, còn ngân sách, chờ ngẫu nhiên 0..1 giây
  P->>B: Lần 2 cùng Idempotency-Key
  alt Đối tác đã hồi phục
    B-->>P: Thành công, hoặc trả kết quả của lần 1 nếu đã xử lý
    P-->>W: Kết quả
    W-->>KH: Nạp thành công
  else Vẫn lỗi sau lần 3
    P-->>W: Hết ngân sách retry
    W-->>KH: Đang xử lý, sẽ thông báo khi hoàn tất
    W->>W: Ghi vào hàng đợi đối soát
  end
  Note over P,B: Hàng nghìn client chờ thời gian khác nhau nên tải quay lại rải đều
```

### 3.3 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| Timeout hai lớp | Giới hạn thời gian kết nối và thời gian nhận phản hồi | Đặt theo p99 bình thường của đối tác nhân 2–3; tổng thời gian kể cả retry không vượt 5 giây theo ràng buộc |
| Bộ phân loại lỗi | Quyết định lỗi nào được retry | Retry: timeout, 503, 429 có `Retry-After`, lỗi kết nối. Không retry: 4xx khác, lỗi nghiệp vụ |
| Chính sách retry | Giới hạn số lần và ngân sách retry toàn tiến trình | Ngân sách kiểu token bucket: tổng retry không quá 10 % lưu lượng, hết thì fail-fast |
| Backoff với Full Jitter | Tính thời gian chờ mỗi lần | `sleep = random(0, min(cap, base * 2^attempt))`, base 200 ms, cap 2 giây |
| Idempotency-Key | Cho phép retry thao tác ghi mà không nạp trùng | Key sinh một lần cho mỗi lệnh nạp, gửi lại nguyên key ở mọi lần retry |
| Hàng đợi đối soát | Hoàn tất lệnh "đang xử lý" sau khi hết ngân sách | Worker hỏi trạng thái theo key; đối tác chưa có giao dịch thì gửi lại cùng key, ở nhịp cố định |

### 3.4 Điểm dễ sai khi triển khai
- **Retry ở nhiều tầng.** Client retry 3, gateway retry 3, SDK retry 3 là 27 lần gọi cho một lỗi. Quy ước: retry ở *một* tầng, thường là tầng gần người dùng nhất có đủ ngữ cảnh.
- **Jitter "một chút".** Thêm ±100 ms không phá được sự đồng bộ. Full Jitter chọn ngẫu nhiên trên cả khoảng.
- **Retry không idempotent.** Retry lệnh nạp tiền mà không có key là nguồn nạp trùng; phía đối tác phải hỗ trợ key hoặc phải hỏi trạng thái trước khi gửi lại.
- **Timeout tổng lớn hơn timeout của người gọi mình.** Nếu API Gateway cắt ở 5 giây mà wallet retry tới 9 giây, kết quả thành công bị bỏ rơi. Timeout phải co lại theo tầng.
- **Đếm retry là thành công.** Retry che lỗi khỏi dashboard; phải có counter retry theo nguyên nhân để thấy đối tác đang yếu.
- **Retry lỗi 429 ngay.** Khi đối tác bảo "chậm lại", tôn trọng `Retry-After` thay vì tự tính backoff.
- **Đối soát chỉ hỏi mà không gửi lại.** Gặp khi đo: thiết kế ban đầu của mục 3.3 chỉ hỏi trạng thái, nên 987 lệnh chưa từng tới đối tác đều thất bại, nhiều hơn 696 lệnh lỗi của bản "trước". Có Idempotency-Key thì gửi lại cùng key là an toàn, kể cả khi lệnh gốc còn trên đường.
- **Đặt tác dụng phụ trong bộ lọc retry.** `cockatiel` gọi bộ lọc cả ở lần lỗi cuối, lúc không retry nữa. Bản đầu tiêu token trong bộ lọc nên mỗi lệnh mất thêm một token. Tiêu token ở sự kiện `onRetry`.
- **Sai số số thực trong token bucket.** Cộng 0,1 mười lần cho 0,999..., không bao giờ đủ 1 token nếu so bằng `>= 1`.

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ngôn ngữ, ứng dụng | TypeScript strict, NestJS | Trùng stack repo | Fastify |
| Chính sách retry/timeout | `cockatiel` | Có sẵn retry với exponential backoff kèm jitter, timeout, và kết hợp chính sách; tránh tự viết sai | `p-retry` + timeout tay; tự viết khoảng 80 dòng để hiểu cơ chế |
| HTTP client | `undici` | Tách timeout kết nối, headers, body; là client chuẩn của Node | axios |
| Mô phỏng tranh chấp | Script Node mô phỏng 1.000 client, theo cách của Brooker | Cho thấy tổng số lần gọi và thời gian hoàn tất theo từng chiến lược jitter mà không cần hạ tầng | — |
| Tiêm lỗi | Toxiproxy | Tạo sự cố 20 giây có kiểm soát giữa wallet và đối tác giả | Cờ lỗi trong đối tác giả |
| Đo | k6, Prometheus + `prom-client` | k6 đo đỉnh request/giây tới đối tác và thời gian hồi phục; counter retry theo nguyên nhân | Grafana |
| Hạ tầng local | Docker Compose | wallet, đối tác giả, Toxiproxy, Prometheus | — |

**Thay đổi so với hệ thống hiện tại:** thay HTTP client có timeout và chính sách retry tập trung; thêm Idempotency-Key vào hợp đồng với đối tác; thêm hàng đợi đối soát cho lệnh chưa xác định; đội vận hành theo dõi thêm counter retry và tỷ lệ "đang xử lý".

**Ghi chú khi làm lab**
- Phiên bản: NestJS 10.4.22, `cockatiel` 3.2.1, `undici` 7.30.1, Fastify 5.12.5, `prom-client` 15.1.3, Toxiproxy 2.12.0, Prometheus 3.14.0, k6 1.4.2. `cockatiel` 4 và `undici` 8 đòi Node ≥ 22 nên lab trên Node 20 ghim hai bản trên.
- Full Jitter viết tay trong `DelegateBackoff`, vì cần tôn trọng `Retry-After` theo từng lỗi.
- Đối tác giả chỉ có mô hình quá tải đơn giản: vượt 100 request/giây thì trả 503, không tự sụp hay chậm đi. Lab cố ý không viết đối tác sụp theo ý muốn, nên không tái hiện được "25 phút mới hồi phục".
- Sự cố dùng toxic `timeout` 0 ms ở chiều gửi đi: dữ liệu bị giữ, kết nối không đóng, tới khi gỡ toxic. Đối tác treo chứ không từ chối.
- Tổng thời gian kể cả retry dừng ở 4,8 giây, nên trong sự cố treo một lệnh chỉ kịp hai lần thử.
- Hàng đợi đối soát nằm trong bộ nhớ, tiến trình chết là mất; thật thì phải bền. Bài không có database.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| Đỉnh request/giây tới đối tác trong 10 giây sau khi hồi phục, so với bình thường | gấp 3,5 lần | ≤ 1,3 lần | Counter request ở đối tác giả theo giây; Toxiproxy tạo sự cố 20 giây |
| Thời gian hệ thống hồi phục sau sự cố 20 giây | 25 phút | ≤ 1 phút | k6 chạy liên tục, thời điểm tỷ lệ thành công quay về ≥ 99 % |
| Request treo quá 5 giây | nhiều | 0 | Histogram độ trễ ở wallet, bucket > 5 giây |
| Tỷ lệ thành công khi đối tác lỗi lẻ 5 % | 95 % | ≥ 99,5 % | k6 với đối tác giả trả 503 ngẫu nhiên 5 % |
| Giao dịch nạp trùng | có | 0 | Test tích hợp: đối tác giả ghi lại key, đếm giao dịch theo key |
| Tổng số lần gọi trong mô phỏng 1.000 client tranh chấp | backoff không jitter | Full Jitter thấp hơn rõ, số đo thật ghi lại | Script mô phỏng in tổng lần gọi và thời gian hoàn tất theo chiến lược |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** sự cố ngắn của đối tác chỉ gây gián đoạn ngắn tương ứng; không còn nạp trùng; tổng đài không bị quá tải vì lỗi dây chuyền.

### 5.1 Số đã đo

**Môi trường** (đo ngày 2026-11-04): Apple M5, 10 nhân, 32 GB RAM, macOS (Darwin 25.6.0), chạy pin, mở nắp. Docker Desktop 29.9.2, Compose v5.6.1, máy ảo Docker 10 CPU và 7,75 GiB RAM. Service trên `node:20-alpine` (Node 20.20.2), k6 1.4.2 cùng mạng Compose. Load 1 phút của macOS: 2,6 – 4,5.

**Tải:** mô hình mở 50 request/giây trong 3 phút, đối tác treo 20 giây ở phút thứ 1, công suất đối tác 100 request/giây, không rớt iteration nào. Kịch bản lỗi lẻ: 5 % request trả 503, 60 giây. Số đỉnh gồm cả lệnh gửi và lệnh hỏi của đối soát.

**Các lượt dùng trong bảng:** bản trước có `main` và `round-2`. Bản sau có `main`, `round-2` (đối soát chỉ hỏi, thiết kế ban đầu) và `fix-2` (đối soát gửi lại, bản cuối). Lượt `fix-1` bị loại vì máy ngủ từ 13:40:10 tới 13:41:49 và nguồn điện đổi giữa lượt.

| Chỉ số | Trước | Sau | Mục tiêu | Kết luận |
|---|---|---|---|---|
| Đỉnh request/giây trong 10 giây sau hồi phục, so với bình thường | 19,8 lần (990/50), 19,3 lần | 1,2 lần, 2,16 lần, 2,24 lần (112/50, bản cuối) | ≤ 1,3 lần | **Không đạt ổn định:** 1/3 lượt đạt. Hai lượt vọt trong đúng một giây rồi về 60 request/giây (1,2 lần) |
| Thời gian hồi phục sau sự cố 20 giây | 2 giây, 1 giây | 1 giây (bản cuối) | ≤ 1 phút | Đạt, nhưng bản trước cũng đạt |
| Request treo quá 5 giây | 910, 910 | 0 ở cả ba lượt | 0 | Đạt |
| Tỷ lệ thành công khi đối tác lỗi lẻ 5 % | 100 % (3.001/3.001) | 100 % (3.001/3.001) | ≥ 99,5 % | Đạt, nhưng bản trước cũng đạt vì nó có retry |
| Giao dịch nạp trùng | 3 giao dịch thừa cho một lệnh khi phản hồi mất ở mọi lần | 0 | 0 | Đạt, kiểm bằng test và bằng số giao dịch của đối tác |
| Tổng số lần gọi, mô phỏng 1.000 client | 500.500 (không jitter) | 9.702 (Full Jitter) | thấp hơn rõ | Đạt |

**Kết cục cuối của lệnh nạp trong kịch bản sự cố** (chỉ số thêm khi làm, không có ở bảng mục 5):

| Lượt | Hoàn tất ngay | Qua đối soát rồi hoàn tất | Thất bại | Tỷ lệ hoàn tất |
|---|---|---|---|---|
| Trước, `main` | 8.304 | không áp dụng | 696 | 92,3 % |
| Trước, `round-2` | 8.270 | không áp dụng | 730 | 91,9 % |
| Sau, đối soát chỉ hỏi, `main` | 8.014 | 0 | 987 | 89,0 % |
| Sau, đối soát chỉ hỏi, `round-2` | 8.052 | 0 | 949 | 89,5 % |
| **Sau, bản cuối, `fix-2`** | **8.048** | **953** | **0** | **100 %** |

**Độ trễ trong kịch bản sự cố** (đơn vị ms): bản trước p95 14.098,3, p99 19.964,2, lớn nhất 22.911,8 (`main`). Bản sau p95 4.087,3, p99 4.803,1, lớn nhất 4.887,9 (`fix-2`). Hạn chót 4,8 giây thể hiện rõ ở p99.

**Mô phỏng** (`pnpm sim:jitter`, 1.000 client, trung vị 20 hạt, không cần hạ tầng):

| Chiến lược | Tổng lần gọi | Số khe tới khi xong |
|---|---|---|
| Không jitter | 500.500 | 4.051.942 |
| Equal Jitter | 9.682 | 6.374 |
| Full Jitter | 9.702 | 5.440 |
| Decorrelated Jitter | 14.395 | 2.082 |

**Đọc số này thế nào**
- Đỉnh của bản trước gấp khoảng 19 lần, cao hơn nhiều số 3,5 lần ở mục 5: không có timeout nên gần 1.000 lệnh treo được giải phóng cùng lúc khi đối tác trở lại, rồi 503 lại kéo theo retry cùng nhịp.
- Bản sau chạy ổn định ở 60 request/giây sau sự cố: 50 lệnh mới cộng khoảng 10 lời gọi đối soát. Hai lượt có một giây lên 108 và 112. Nguyên nhân chưa tách riêng được; có thể là dữ liệu Toxiproxy giữ được xả ra khi gỡ toxic. Mục tiêu 1,3 lần vì vậy chưa đạt ổn định, dù đã thấp hơn bản trước khoảng 9 lần.
- "Hồi phục 25 phút" không tái hiện được và cả hai bản đều hồi phục trong vài giây. Đối tác giả chỉ từ chối phần vượt công suất chứ không sụp, nên đợt retry tự tan. Lab không chứng minh được hiện tượng "ngã lần hai".
- Bản trước đạt 100 % với lỗi lẻ vì nó cũng retry; 95 % ở mục 5 là trường hợp không retry. Điểm khác là bản trước retry cả lỗi xác định và không có key.
- Bản sau không thắng về tỷ lệ hoàn tất cho tới khi đối soát biết gửi lại. Không đo kết cục cuối thì đã không thấy điều này: lượt `main` nhìn rất đẹp về đỉnh tải và độ trễ, trong khi mất nhiều lệnh hơn bản trước.
- Mô phỏng theo mô hình đơn giản: mỗi khe một lời gọi thắng. Không jitter ra đúng N(N+1)/2 lần gọi vì các client trùng nhịp mãi mãi, một trường hợp cực đoan. Equal và Full gần như ngang nhau về số lần gọi, còn Decorrelated tốn nhiều lần gọi hơn nhưng xong sớm nhất.

**Test:** 23/23 đạt, không cần Docker. `node scripts/kiem-chung-lab.mjs` đạt 6/6 bước từ đầu. Đã kiểm trực tiếp trên Compose: `wallet_topups_total` và `wallet_reconcile_queue_depth` tới được Prometheus.

**Phép thử âm** (`pnpm bench:drills`, số test đỏ trên số test của file bảo vệ phần đó):

| Gỡ phần nào của pattern | Test đỏ |
|---|---|
| Bỏ Idempotency-Key | 3/6 |
| Mỗi lần retry sinh key mới | 3/6 |
| Retry cả lỗi xác định | 2/13 |
| Bỏ ngân sách retry | 1/13 |
| Bỏ jitter | 2/13 |
| Bỏ timeout và hạn chót tổng | 1/13 |
| Đối soát chỉ hỏi, không gửi lại | 1/6 |
| Không tôn trọng `Retry-After` | 1/13 |

**Hạn chế:** bản cuối chỉ có một lượt sạch (`fix-2`). Một instance wallet và một máy, nên ngân sách retry chưa được thử trên nhiều instance. Chạy pin, cùng nguồn điện ở các lượt dùng trong bảng. Hàng đợi đối soát trong bộ nhớ nên chưa kiểm tình huống wallet chết giữa chừng.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Backoff làm tăng độ trễ của request bị lỗi; phải cân với ràng buộc 5 giây bằng cap và số lần retry.
- Cần đối tác hỗ trợ idempotency hoặc API hỏi trạng thái; không có thì chỉ retry được thao tác đọc.
- Nhiều tham số (timeout, base, cap, số lần, ngân sách) cần ghi tài liệu và xem lại định kỳ.

**Không nên dùng khi**
- Thao tác không idempotent và không thể hỏi lại trạng thái: retry tạo trùng, chỉ nên fail và đối soát.
- Lỗi là *xác định* (400, 401, dữ liệu sai): retry chỉ lặp lại lỗi và tốn tài nguyên.
- Phụ thuộc đang quá tải kéo dài: retry dù có jitter vẫn thêm tải; khi đó cần cầu dao (bài 03) hoặc load shedding (`18` bài 05).

**Liên quan**
- Đọc trước: `../../01-frontend-backend-transporter/03-idempotency-key-bam-thanh-toan-hai-lan/` — điều kiện để retry thao tác ghi.
- Đọc sau: `../03-circuit-breaker-service-khuyen-mai-cham-lam-sap-checkout/` — ngừng gọi khi lỗi kéo dài.
- Cùng chủ đề: `../../13-backend-transporter/05-async-request-reply-xu-ly-30-giay-http-timeout/`; `../../13-backend-transporter/04-webhook-delivery-doi-tac-down-5-phut-mat-su-kien/` — retry ở chiều ngược lại.

## 7. Cơ sở tham khảo

- Marc Brooker, "Timeouts, retries, and backoff with jitter", Amazon Builders' Library — https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ — bộ ba kỹ thuật, retry ở một tầng, giới hạn retry bằng token bucket.
- Marc Brooker, "Exponential Backoff And Jitter", AWS Architecture Blog, 2015 — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ — mô phỏng so sánh No Jitter, Full Jitter, Equal Jitter, Decorrelated Jitter; cơ sở cho script mô phỏng ở mục 8.
- Microsoft Azure Architecture Center, "Retry pattern" — https://learn.microsoft.com/azure/architecture/patterns/retry — phân loại lỗi nên và không nên retry, cân nhắc về idempotency.
- Amazon Builders' Library, "Making retries safe with idempotent APIs" — vì sao retry thao tác ghi cần khóa chống trùng.
- cockatiel — https://github.com/connor4312/cockatiel — thư viện chính sách retry, timeout dùng ở mục 4.
- k6 docs — https://grafana.com/docs/k6/ — kịch bản tải và `checks` dùng để đo.

## 8. Kế hoạch thực hành

- [x] Bước 1: viết đối tác giả (Fastify) có cờ sự cố và counter request theo giây; wallet-service với HTTP client mặc định và retry cố định; Toxiproxy ở giữa; Docker Compose.
- [x] Bước 2: đo "trước": k6 50 request/giây trong 3 phút, Toxiproxy cắt kết nối 20 giây ở phút 1; ghi đỉnh request tới đối tác sau hồi phục và thời gian hồi phục. Chạy script mô phỏng 1.000 client để có số tổng lần gọi với backoff không jitter.
- [x] Bước 3: thay bằng `undici` có timeout, `cockatiel` retry 3 lần với Full Jitter và ngân sách; phân loại lỗi; thêm Idempotency-Key và hàng đợi đối soát.
- [x] Bước 4: đo "sau" cùng kịch bản; ghi số thật và môi trường vào mục 5; so sánh các chiến lược jitter bằng script mô phỏng.
- [x] Bước 5: test: (a) lỗi 400 không retry; (b) 503 retry tối đa 3 lần với thời gian chờ nằm trong khoảng kỳ vọng; (c) hai lần gửi cùng key chỉ tạo một giao dịch ở đối tác giả; (d) hết ngân sách thì trả "đang xử lý" và ghi hàng đợi đối soát.

**Cấu trúc code**
```text
src/
  wallet/
    bank.client.ts            # [PATTERN] timeout hai lớp, retry, Full Jitter, Idempotency-Key; cả bản trước
    error-classifier.ts       # [PATTERN] lỗi nào được retry
    retry-budget.ts           # [PATTERN] token bucket cho retry
    reconcile.worker.ts       # [PATTERN] hỏi trạng thái theo key, gửi lại cùng key ở nhịp cố định
    wallet.module.ts, metrics.ts
  fake-bank/                  # đối tác giả, ghi key, đếm request theo giây
  shared/                     # log, correlation id, khởi động app
sim/
  jitter-simulation.ts        # 1.000 client tranh chấp, so sánh chiến lược
infra/                        # cấu hình Toxiproxy và Prometheus
test/
  retry-policy.test.ts
  same-key-one-transaction.test.ts
  jitter-simulation.test.ts
bench/
  topup-during-partner-outage.k6.js
  run-scenario.ts             # đo một bản: sự cố 20 giây, kết cục đối soát, lỗi lẻ 5 %
  negative-drills.ts
docker-compose.yml            # wallet, bank, toxiproxy, prometheus; k6 ở profile bench
```

**Cách chạy** *(test không cần Docker; lượt đo chỉ cần Docker, k6 chạy trong container)*
```bash
pnpm install                 # tự gói dist/*.cjs
pnpm typecheck && pnpm test
pnpm sim:jitter              # mô phỏng, in bảng so sánh
pnpm bench:drills            # phép thử âm

# Đo hai bản, mỗi lệnh khoảng 6 phút và tự dọn sau khi xong; đừng gập nắp máy trong lúc đo
pnpm bench:scenario --variant truoc --run main
pnpm bench:scenario --variant sau --run main
```

## Bài học sau khi làm

- Kết quả quan trọng nhất đến từ một chỉ số không có trong kế hoạch. Theo đúng thiết kế ban đầu, bản sau đẹp về đỉnh tải và độ trễ nhưng mất 987 lệnh, nhiều hơn 696 của bản trước. Chỉ thấy điều này nhờ đo kết cục cuối của lệnh "đang xử lý". Sau khi đối soát gửi lại cùng key: 9.001/9.001 lệnh hoàn tất, không trùng.
- Idempotency-Key không chỉ để chống trùng khi retry, mà còn là thứ cho phép gửi lại muộn một cách an toàn.
- Timeout và jitter làm tốt đúng việc của chúng: 0 request treo quá 5 giây so với 910, và đỉnh tải giảm khoảng 9 lần. Nhưng mục tiêu 1,3 lần chưa đạt ổn định.
- Bản "trước" không tệ như đề bài. Nó hồi phục trong 1 – 2 giây và chịu được lỗi lẻ vì đã có retry. Lab không tái hiện "25 phút" vì đối tác giả không được viết để sụp theo ý muốn; hiện tượng đó cần đối tác mất công suất khi quá tải.
- Bộ lọc retry không được có tác dụng phụ, và token bucket số thực cần dung sai: cả hai lỗi này đều do test bắt được.
- Lượt `fix-1` bị loại vì máy gập nắp giữa lượt. Bộ phát hiện khoảng ngủ trong script đã báo, đối chiếu lại bằng `pmset -g log`.
