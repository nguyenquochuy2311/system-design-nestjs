# Quy ước code thực hành

## Mục tiêu của code trong repo

Code ở đây để **chứng minh pattern và đo được kết quả**, không phải để ship. Vì vậy ưu tiên:
đọc hiểu trong 15 phút > tối ưu; tái hiện được triệu chứng "trước" rồi mới áp pattern "sau";
test nói lên hành vi cốt lõi của pattern (ví dụ: gửi hai request cùng Idempotency-Key chỉ tạo
một giao dịch).

## Stack mặc định và lý do

| Lớp | Mặc định | Lý do |
|---|---|---|
| Ngôn ngữ | TypeScript 5.x, `strict: true`, Node 20+ | Trùng stack sản phẩm đang làm; type giúp đọc hiểu pattern |
| HTTP app | NestJS 10 (hoặc Fastify thuần cho bài nhỏ) | Module hóa rõ, DI sẵn; Fastify khi NestJS là quá tay |
| Frontend | Next.js (App Router), React | Scope frontend/cache/realtime cần SSR và client cache |
| DB | PostgreSQL 16 | Đủ tính năng cho hầu hết bài (partition, RLS, FTS, pgvector, PGMQ) |
| Cache / PubSub | Redis 7 | Chuẩn de facto cho cache-aside, lock, rate limit, pub/sub |
| Queue | PGMQ hoặc BullMQ; Kafka/RabbitMQ/NATS khi bài yêu cầu | Bắt đầu từ cái đơn giản nhất đủ dùng |
| Hạ tầng local | Docker Compose | Một lệnh dựng được môi trường tái hiện |
| Test | Vitest (hoặc Jest nếu dùng NestJS CLI mặc định) | Nhanh, ESM tốt |
| Đo tải | k6 | Script đo lặp lại được, có percentiles |
| LLM | Anthropic SDK TypeScript (`@anthropic-ai/sdk`), model mặc định `claude-opus-5-5`; model nhỏ cho worker/judge: `claude-sonnet-5-5`, `claude-haiku-4-5` | Theo tài liệu chính thức platform.claude.com; ID model lấy từ docs, không tự chế hậu tố ngày |

Chọn khác khi pattern đòi hỏi (gRPC bài so sánh có thể dùng Go; Service Mesh cần cluster). Ghi lý do
ở mục 4 README.

## Cấu trúc một bài

```text
NN-<bai>/
├── README.md
├── docker-compose.yml        # Postgres/Redis/... với healthcheck
├── .env.example
├── package.json              # scripts: dev, test, bench
├── tsconfig.json
├── src/
│   ├── truoc/                # (tùy chọn) phiên bản tái hiện triệu chứng
│   ├── sau/                  # phiên bản áp dụng pattern
│   └── shared/
├── test/
│   └── *.test.ts             # test hành vi cốt lõi của pattern
└── bench/
    └── *.k6.js               # script đo trước/sau nếu bài có chỉ số hiệu năng
```

Hai thư mục `truoc/` và `sau/` không bắt buộc, nhưng rất đáng khi triệu chứng có thể tái hiện bằng
code (N+1, lost update, stampede). Người học chạy "trước" thấy lỗi, chạy "sau" thấy hết lỗi.

## Nguyên tắc viết

- **Nhỏ và thẳng.** Một bài thường dưới 500 dòng code. Không framework tự chế, không abstraction
  cho tương lai.
- **Tên theo nghiệp vụ**: `createOrder`, `reserveStock`, `OrderRepository` — không `Manager`, `Helper`.
- **Comment tiếng Việt, ngắn, nói "vì sao"** — không nhắc lại code. Ghi rõ dòng nào là "điểm pattern"
  bằng comment `// [PATTERN] ...` để người đọc tìm nhanh.
- **Lỗi phải hiện rõ**: không nuốt exception; log có ngữ cảnh (id request, key).
- **Cấu hình qua biến môi trường**, có `.env.example`; không secret trong code.
- **Idempotent setup**: `docker compose up -d` chạy lại không hỏng; migration/seed chạy lại được.
- **Test đặt tên theo hành vi**: `it('hai request cùng Idempotency-Key chỉ tạo một giao dịch')`.
- **Đo lường có ghi môi trường**: máy, phiên bản, số lần chạy, cách warm-up. Số không có môi trường
  là số không tin được.

## Checklist code trước khi đổi trạng thái ✅

- [ ] `docker compose up -d && pnpm install && pnpm test` chạy xanh từ máy sạch.
- [ ] Test chứng minh hành vi cốt lõi của pattern (ít nhất 1 test "trước" fail / "sau" pass nếu áp dụng được).
- [ ] Số đo thật ghi vào mục 5 README kèm môi trường.
- [ ] Không có TODO/console.log thừa; không secret.
- [ ] Mục 3.4 README cập nhật điểm dễ sai gặp thật khi làm.

## Ngoại lệ đã chốt (xem `docs/nhat-ky-quyet-dinh.md`)

- Bài thống kê/huấn luyện/lượng tử hóa được dùng Python; ghi lý do ở mục 4 của bài.
- File Python được import hoặc pytest tự tìm dùng `snake_case`; file chạy như script đơn lẻ giữ kebab-case.
- Tên file code luôn bằng tiếng Anh, kể cả file test và script đo (ví dụ `opens-after-n-failures.test.ts`).
