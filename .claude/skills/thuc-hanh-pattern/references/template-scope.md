# Template README cho một scope

README scope là **kế hoạch có cơ sở** của scope: nó liệt kê các bài toán, đặt chúng vào một bản đồ
quan hệ và chốt nguồn gốc pattern trước khi ai đó viết chi tiết. Agent viết README bài toán chỉ được
dùng pattern và nguồn ghi ở đây (hoặc trong danh mục nguồn chung).

```markdown
# NN · <Tên scope tiếng Việt> (`<scope / slug theo đề bài>`)

> **Phạm vi:** <2–3 câu: lớp hệ thống nào, loại vấn đề nào thuộc scope này, cái gì KHÔNG thuộc.>
>
> **Câu hỏi trung tâm:** <một câu hỏi mà toàn scope xoay quanh>.

## Bản đồ pattern trong scope

```mermaid
flowchart TB
  <các bài toán là node; mũi tên = "nên học trước" hoặc "kết hợp với"; nhóm theo mức độ bằng subgraph>
```

## Danh sách bài toán

| # | Bài toán (pattern — triệu chứng) | Mức | Pattern gốc / nguồn | Trạng thái |
|---|---|---|---|---|
| 01 | [<Pattern> — <triệu chứng>](./01-<slug>/) | 🟢 | <nguồn gốc ngắn> | 📋 |

## Lộ trình đề xuất trong scope

1. <bài> — vì <lý do nền tảng>
2. ...

## Kiến thức nền cần có trước

- <khái niệm / công nghệ cần biết để không lạc>

## Liên kết với scope khác

- <scope khác> — <bài nào ở đó bổ trợ bài nào ở đây>

## Nguồn tổng quan cho scope

- <1–4 tài liệu nền tảng nhất của scope, để đọc trước mọi bài>
```

## Ghi chú

- Bảng bài toán là **hợp đồng** với các phiên sau: thêm/bớt bài phải sửa bảng này và ghi nhật ký.
- Bản đồ pattern giúp người học thấy bài nào là nền của bài nào; không cần vẽ mọi quan hệ, chỉ
  quan hệ "nên học trước" và "thường đi cùng".
- Cột "Pattern gốc / nguồn" ghi ngắn (tác giả + năm hoặc tên docs). Chi tiết URL nằm ở README bài.
