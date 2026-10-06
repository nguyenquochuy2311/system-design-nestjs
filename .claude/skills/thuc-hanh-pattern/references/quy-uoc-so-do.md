# Quy ước sơ đồ (Mermaid)

## Vì sao Mermaid

GitHub render Mermaid trực tiếp trong Markdown, diff được bằng Git, không cần công cụ vẽ. Nhược điểm
(bố cục tự động, ít kiểu dáng) chấp nhận được vì mục tiêu là *giải thích cơ chế*, không phải đẹp.

## Hai sơ đồ tối thiểu cho mỗi bài

1. **Kiến trúc trước/sau** — `flowchart LR` hoặc `TB`. Cho thấy pattern *thêm* hoặc *đổi* gì.
2. **Luồng chính** — `sequenceDiagram`. Ưu tiên luồng mà pattern thực sự xử lý (lỗi, trùng lặp,
   timeout, mất mạng), vì luồng thành công thường hiển nhiên.

Sơ đồ thứ ba trở đi chỉ khi cần: `stateDiagram-v2` cho vòng đời (job, đơn hàng, circuit breaker),
`erDiagram` cho bài về schema, `gantt`/timeline hiếm khi cần.

## Quy tắc viết

- **Nhãn tiếng Việt, tên kỹ thuật tiếng Anh**: `Redis`, `PostgreSQL`, `API Gateway`, `Worker`.
  Ví dụ node: `GW["API Gateway<br/>(xác thực, giới hạn tốc độ)"]`.
- **Tô màu phần pattern thêm vào** để mắt bắt ngay sự thay đổi. Dùng `classDef` cố định:

  ```mermaid
  flowchart LR
    classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
    classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
    classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D
    FE["Frontend"]:::cu --> GW["API Gateway"]:::moi --> SVC["Order Service"]:::cu
  ```

  `moi` = thành phần mới do pattern; `cu` = thành phần sẵn có; `loi` = điểm hỏng đang minh họa.
- **Sequence diagram**: đặt tên participant ngắn, dùng `alt`/`opt`/`loop` cho rẽ nhánh, `Note over`
  để ghi chú quyết định quan trọng. Tối đa khoảng 15 message; dài hơn thì tách luồng.
- **Một ý một sơ đồ.** Sơ đồ cố nói hai chuyện thường không nói được chuyện nào.
- Tránh ký tự dễ làm hỏng cú pháp trong nhãn: dấu `"` trong nhãn đã có `"`, dấu `;`, `{}` ngoài
  node hình thoi. Dùng `<br/>` để xuống dòng trong nhãn. Dấu ngoặc tròn trong nhãn phải nằm trong `"..."`.
- Không dùng `%%{init}` theme tùy biến; để GitHub chọn theme sáng/tối.

## Kiểm tra trước khi commit

Chạy `node scripts/xem-mermaid.mjs` rồi mở http://localhost:8765/mermaid-check.html — trang parse mọi khối
Mermaid trong repo và liệt kê lỗi cú pháp theo file. Hoặc dán vào Mermaid Live Editor (mermaid.live).
Một sơ đồ lỗi cú pháp trên GitHub hiện ra là khối lỗi đỏ, phá toàn bộ trải nghiệm đọc.
