# Quy ước đặt tên

## Vì sao cần quy ước

Tên là giao diện của repo. Một người lướt GitHub phải nhận ra bài toán của mình qua tên thư mục
mà không cần mở README. Quy ước giúp 190+ bài có cùng "hình dạng" dù do nhiều phiên viết.

## Thư mục scope

`NN-<scope-slug>` — số hai chữ số theo thứ tự trong README gốc, slug tiếng Anh không dấu.
Danh sách 24 scope là cố định; thêm scope là quyết định phải ghi nhật ký.

## Thư mục bài toán

```text
NN-<pattern-slug>-<trieu-chung-slug>
```

- `NN`: thứ tự trong scope, phản ánh lộ trình (bài nền số nhỏ).
- `<pattern-slug>`: tên pattern tiếng Anh, chữ thường, nối gạch (`idempotency-key`, `cache-aside`,
  `transactional-outbox`). Tên nhiều từ có thể viết tắt nếu tên tắt phổ biến hơn (`bff`, `cqrs`, `hpa`).
- `<trieu-chung-slug>`: triệu chứng rút gọn, tiếng Việt **không dấu**, 3–8 từ, chữ thường.
- Ví dụ: `03-idempotency-key-bam-thanh-toan-hai-lan`, `05-cache-stampede-flash-sale-cache-het-han-db-sap`.
- Không dùng ký tự ngoài `[a-z0-9-]`. Không dùng dấu gạch dưới.

## Tiêu đề H1

```text
<Tên pattern tiếng Anh> — <Triệu chứng bằng lời người kinh doanh>
```

- Dấu phân cách là gạch dài ` — ` (U+2014, có khoảng trắng hai bên).
- Tên pattern viết đúng cách viết của tài liệu gốc (`Cache-Aside`, `Circuit Breaker`, `CQRS`,
  `Backend for Frontend (BFF)`).
- Triệu chứng viết bằng ngôn ngữ kinh doanh: nói về tiền, khách hàng, thời gian, nhân sự; tránh
  thuật ngữ kỹ thuật ở nửa sau tiêu đề nếu có thể. Ví dụ tốt: *"Hai nhân viên cùng sửa một đơn,
  người lưu sau ghi đè người lưu trước"*. Ví dụ chưa tốt: *"Lost update do thiếu version column"*.

## Mức độ

| Nhãn | Nghĩa |
|---|---|
| 🟢 Cơ bản | Một thành phần, hiểu trong một buổi, cần thiết cho mọi hệ thống |
| 🟡 Trung bình | Nhiều thành phần phối hợp hoặc có đánh đổi cần cân nhắc |
| 🔴 Nâng cao | Hệ phân tán, nhiều chế độ lỗi, hoặc đòi hỏi kiến thức nền từ nhiều bài khác |

## Trạng thái

| Nhãn | Điều kiện |
|---|---|
| 📋 Kế hoạch | README đủ 8 mục, chưa có code |
| 🔨 Đang làm | Có code trong `src/`, chưa đạt điều kiện hoàn thành |
| ✅ Hoàn thành | Code chạy theo README, test pass, có số đo thật, có mục "Bài học sau khi làm" |

## Bảng metadata dưới H1

Luôn là bảng 5 cột theo đúng thứ tự: `Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật`.
Script `tao-tien-do.mjs` nhận diện dòng dữ liệu qua emoji ở cột 2 và cột 3, nên hai cột đó phải
bắt đầu bằng emoji. Ngày theo `YYYY-MM-DD`.

## Tên file và thư mục code

- Thư mục: `src/`, `test/`, `docker-compose.yml`, `.env.example`.
- File TypeScript: kebab-case (`order-repository.ts`), test cùng tên `.test.ts`.
- Không đặt tên file/biến bằng tiếng Việt; comment và README bằng tiếng Việt.
