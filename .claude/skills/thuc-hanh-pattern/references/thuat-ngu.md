# Thuật ngữ: giữ tiếng Anh hay dịch?

Nguyên tắc: **tên pattern, tên công nghệ, tên khái niệm có tài liệu gốc tiếng Anh → giữ nguyên**,
giải thích bằng tiếng Việt lần đầu xuất hiện trong bài. **Khái niệm phổ thông → dịch.**
Mục đích là người đọc tra được tài liệu gốc và nói chuyện được với đồng nghiệp quốc tế.

## Giữ nguyên (kèm cách giải thích gợi ý lần đầu)

| Thuật ngữ | Giải thích lần đầu |
|---|---|
| cache, cache hit/miss | bộ đệm; trúng/trượt bộ đệm |
| cache stampede / thundering herd | nhiều request cùng lúc đổ vào DB khi cache trống |
| idempotent / idempotency | gọi nhiều lần cho cùng kết quả như gọi một lần |
| latency, p50/p95/p99 | độ trễ; phân vị 50/95/99 |
| throughput | thông lượng (request/giây) |
| backpressure | cơ chế phía nhận báo "chậm lại" cho phía gửi |
| circuit breaker | ngắt mạch: tạm ngừng gọi dịch vụ đang lỗi |
| bulkhead | khoang cách ly tài nguyên |
| saga, compensating transaction | chuỗi giao dịch cục bộ có bước bù (hoàn tác) |
| outbox | bảng "hộp thư đi" ghi cùng transaction với dữ liệu |
| dead letter queue (DLQ) | hàng đợi chứa message xử lý thất bại |
| consumer lag | độ trễ của phía tiêu thụ so với phía sản xuất |
| partition / shard | phân mảnh dữ liệu |
| replica, read replica | bản sao; bản sao chỉ đọc |
| tenant, multi-tenant | khách hàng-tổ chức; nhiều tổ chức dùng chung hệ thống |
| embedding, vector | biểu diễn số của văn bản/ảnh |
| RAG (Retrieval-Augmented Generation) | sinh câu trả lời có tra cứu tài liệu |
| reranking | xếp hạng lại kết quả truy hồi |
| prompt, system prompt, tool use | giữ nguyên |
| token, context window | giữ nguyên |
| TTFT (time to first token) | thời gian tới token đầu tiên |
| observability, tracing, span | khả năng quan sát; truy vết; đoạn truy vết |
| SLI / SLO / error budget | chỉ số / mục tiêu mức dịch vụ / ngân sách lỗi |
| rolling update, canary, blue-green | giữ nguyên |
| probe (liveness/readiness) | đầu dò sức khỏe |
| presigned URL | URL ký trước, có hạn |
| monorepo, monolith, microservices | giữ nguyên |
| webhook, callback | giữ nguyên |
| rate limiting, throttling | giới hạn tốc độ; bóp luồng |
| schema, migration | lược đồ; di trú lược đồ — nhưng thường giữ "schema", "migration" |

## Dịch (dùng tiếng Việt)

| Tiếng Anh | Dùng |
|---|---|
| request / response | request / response giữ nguyên trong ngữ cảnh HTTP; "yêu cầu/phản hồi" khi nói chung |
| user | người dùng |
| customer | khách hàng |
| order | đơn hàng |
| payment | thanh toán |
| inventory / stock | kho / tồn kho |
| availability | tính sẵn sàng |
| consistency | tính nhất quán |
| scalability | khả năng mở rộng |
| trade-off | đánh đổi |
| failure / fault | sự cố / lỗi |
| deploy / release | triển khai / phát hành — trong ngữ cảnh kỹ thuật thường giữ "deploy", "release" |
| worker | worker (giữ) |
| background job | tác vụ nền (hoặc giữ "job") |

## Cách viết số và đơn vị

- Dấu phẩy thập phân kiểu Việt trong văn bản: `1,8 GB`, nhưng trong bảng/ code dùng kiểu quốc tế `1.8`.
- Nghìn: `50.000` trong văn bản tiếng Việt; chấp nhận `50k` trong tên bài và bảng.
- Đơn vị thời gian: ms, giây, phút — không viết "s" cho giây trong văn bản.
