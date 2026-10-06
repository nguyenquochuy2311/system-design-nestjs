---
name: thuc-hanh-pattern
description: "Ngữ cảnh chung và quy ước bắt buộc của repo system-design-nestjs — thực hành design pattern giải bài toán doanh nghiệp ở tầng web application, viết hoàn toàn bằng tiếng Việt. Dùng skill này MỖI KHI tạo, sửa, review hay hoàn thiện bất kỳ scope, bài toán, README, sơ đồ Mermaid, code mẫu hay tiến độ trong repo này — kể cả khi người dùng chỉ nói 'thêm bài về cache', 'viết tiếp scope k8s', 'làm bài số 3', 'review README này', 'cập nhật tiến độ' hay 'ghi lại quyết định'. Skill chứa: cách đặt tên bài toán theo pattern, template README (What / Why / How / Tech stack / Impact / Nguồn), quy ước sơ đồ, quy ước code TypeScript, danh mục nguồn được phép trích dẫn và quy tắc không bịa đặt."
---

# Skill: thuc-hanh-pattern

Skill này là "bộ nhớ chung" của repo. Mọi phiên làm việc đều bắt đầu bằng việc đọc nó để giữ cùng
một giọng, cùng một khung mô tả và cùng một tiêu chuẩn về nguồn gốc, dù phiên trước đó là ai viết.

## 1. Repo này để làm gì

Repo là nơi luyện tập **design pattern và system design** bằng cách giải **những vấn đề thật mà
doanh nghiệp gặp ở tầng web application**: trang chậm, trừ tiền hai lần, cache sập lúc flash sale,
chatbot bịa, hóa đơn AI tăng gấp ba... Mỗi bài toán được đặt tên theo **pattern có tên gọi và có
nguồn gốc**, mô tả theo một khung cố định, kèm sơ đồ và (khi thực hành) code chạy được.

Người đọc mục tiêu: kỹ sư web Việt Nam đọc tiếng Việt, tra cứu tài liệu gốc tiếng Anh. Vì vậy
**giải thích bằng tiếng Việt, giữ nguyên tên pattern và thuật ngữ kỹ thuật tiếng Anh** (xem
`references/thuat-ngu.md`). Dịch tên pattern sang tiếng Việt sẽ làm người đọc không tra được tài liệu.

## 2. Nguyên tắc không thỏa hiệp

1. **Không bịa đặt.** Pattern phải có nguồn (tác giả gốc, sách, paper, RFC, tài liệu chính thức).
   Chỉ trích dẫn nguồn đã có trong `references/nguon-tham-khao.md` hoặc nguồn chính thức bạn chắc
   chắn tồn tại. Không chắc thì ghi `(cần xác minh)` ngay sau nguồn, đừng viết như thể đã kiểm.
   Lý do: giá trị của repo nằm ở việc người học tin được rằng "cái này thật, người ta đã dùng".
2. **Số liệu phải có nhãn.** Bài toán dùng số để tạo cảm giác thật ("151 câu SQL", "p99 4 giây").
   Những số đó là *minh họa* trừ khi lấy từ nguồn công khai. Luôn ghi rõ "số liệu minh họa" trong
   phần bối cảnh và "mục tiêu cần đo khi thực hành" trong phần kết quả. Không viết "giảm 80% độ trễ"
   như một kết quả đã đạt khi chưa đo.
3. **Không nêu tên công ty thật làm bối cảnh.** Bối cảnh là doanh nghiệp giả định theo lĩnh vực
   (sàn TMĐT, ví điện tử, bảo hiểm, đấu giá, logistics, CRM nội bộ, SaaS B2B). Case study công khai
   (Stripe, Slack, Shopify, Facebook...) chỉ xuất hiện ở mục "Cơ sở tham khảo" với đúng bài viết.
4. **Hoàn toàn tiếng Việt**, trừ tên pattern, tên công nghệ, tên trường/code và trích dẫn.
5. **Tên bài toán phải nhận ra được triệu chứng.** Người kinh doanh đọc tên phải hiểu vấn đề;
   kỹ sư đọc tên phải biết pattern. Xem mục 5.
6. **Giải bài toán hiện tại, không overengineer.** Code thực hành chỉ đủ để chứng minh pattern và
   đo được kết quả. Ba dòng lặp lại tốt hơn một abstraction sớm.

## 3. Bắt đầu một phiên làm việc

Trước khi viết gì, đọc theo thứ tự (mỗi file ngắn, mất vài phút, tránh làm lệch quy ước):

1. `CLAUDE.md` ở gốc repo (tóm tắt quy ước + lệnh thường dùng).
2. `docs/nhat-ky-quyet-dinh.md` — các quyết định đã chốt và lý do; **không mở lại** quyết định đã
   chốt trừ khi người dùng yêu cầu. Nếu phiên này đưa ra quyết định mới, ghi vào đây.
3. `TIEN-DO.md` — trạng thái từng bài (sinh tự động, không sửa tay).
4. README của scope liên quan — chứa danh sách bài toán đã lên kế hoạch và nguồn đã đối chiếu.
5. Template liên quan trong `references/` (xem mục 10).

## 4. Cấu trúc repo

```text
system-design-nestjs/
├── README.md                     # Tổng quan, 24 scope, cách đọc
├── CLAUDE.md                     # Trỏ tới skill này + lệnh nhanh
├── TIEN-DO.md                    # Sinh bởi scripts/tao-tien-do.mjs
├── docs/
│   ├── lo-trinh-hoc.md           # Thứ tự học xuyên scope
│   ├── nhat-ky-quyet-dinh.md     # Decision log (bộ nhớ dài hạn)
│   └── nguon-tham-khao.md        # Trỏ tới danh mục nguồn chuẩn trong skill
├── scripts/
│   ├── tao-tien-do.mjs           # Quét README bài toán → TIEN-DO.md
│   └── kiem-tra-readme.mjs       # Lint cấu trúc README bài toán
├── NN-<scope>/                   # 01..24, slug tiếng Anh không dấu
│   ├── README.md                 # Bản đồ pattern + bảng bài toán + lộ trình
│   └── NN-<pattern>-<trieu-chung>/
│       ├── README.md             # Theo references/template-bai-toan.md
│       ├── src/                  # Code thực hành (khi làm)
│       ├── test/
│       └── docker-compose.yml    # Nếu cần hạ tầng (Postgres, Redis...)
└── .claude/skills/thuc-hanh-pattern/   # Skill này
```

## 5. Đặt tên (tóm tắt — chi tiết ở `references/quy-uoc-dat-ten.md`)

- **Thư mục scope:** `NN-<scope-slug>` theo đúng 24 scope trong README gốc. Không thêm scope mới
  nếu chưa ghi vào nhật ký quyết định.
- **Thư mục bài toán:** `NN-<pattern-slug>-<trieu-chung-slug>`, chữ thường, không dấu, nối bằng `-`.
  Ví dụ: `03-idempotency-key-bam-thanh-toan-hai-lan`.
- **Tiêu đề H1 của bài:** `<Tên pattern tiếng Anh> — <Triệu chứng bằng lời người kinh doanh>`.
  Ví dụ: `Idempotency Key — Khách bấm "Thanh toán" hai lần vì mạng chập chờn, bị trừ tiền hai lần`.
- **Mức độ:** 🟢 Cơ bản · 🟡 Trung bình · 🔴 Nâng cao. **Trạng thái:** 📋 Kế hoạch · 🔨 Đang làm ·
  ✅ Hoàn thành. Hai cột này nằm trong bảng metadata ngay dưới H1 để script đọc được.

## 6. Quy trình theo loại việc

### 6.1 Thêm bài toán vào một scope
1. Đọc README scope: kiểm tra bài chưa trùng pattern/triệu chứng với bài có sẵn.
2. Tìm nguồn gốc pattern trong `references/nguon-tham-khao.md`. Chưa có → tìm nguồn chính thức,
   thêm vào danh mục (đúng mục), rồi mới dùng.
3. Thêm một dòng vào bảng bài toán của README scope (số thứ tự tiếp theo) và cập nhật sơ đồ bản đồ.
4. Tạo thư mục + `README.md` theo `references/template-bai-toan.md`, trạng thái 📋.
5. Chạy `node scripts/kiem-tra-readme.mjs` rồi `node scripts/tao-tien-do.mjs`.

### 6.2 Viết README bài toán
Dùng đúng 8 mục của template, không bỏ mục, không đổi thứ tự (script lint kiểm tra tiêu đề mục).
Viết mục 1 (What) trước và viết cho người kinh doanh đọc hiểu; mục 2 (Why) phải so sánh ít nhất
một lựa chọn khác và nói vì sao không chọn; mục 3 (How) có tối thiểu một sơ đồ kiến trúc và một
sequence diagram; mục 5 (Impact) là bảng chỉ số có cột "cách đo"; mục 7 là nguồn.

### 6.3 Thực hành code cho một bài
1. Đổi trạng thái sang 🔨, cập nhật ngày.
2. Code trong `src/` theo `references/quy-uoc-code.md` (TypeScript strict, cấu trúc nhỏ gọn,
   test chứng minh pattern, `docker-compose.yml` cho hạ tầng, README mục 8 ghi cách chạy).
3. Đo đúng các chỉ số đã khai báo ở mục 5; ghi số đo thật vào bảng kèm môi trường đo.
4. Đổi trạng thái sang ✅ chỉ khi: code chạy từ hướng dẫn trong README, test pass, có số đo thật.
5. Ghi bài học vào cuối README (mục "Bài học sau khi làm") và vào nhật ký nếu là quyết định chung.

### 6.4 Review một bài
Dùng checklist mục 9. Phản hồi theo dạng: `Vấn đề → Bằng chứng (dòng/mục) → Đề xuất`. Ưu tiên
lỗi về nguồn và lỗi về logic pattern hơn lỗi hành văn.

### 6.5 Cập nhật tiến độ và ghi nhớ
- `TIEN-DO.md` chỉ sinh bằng script, không sửa tay.
- Mọi quyết định có tính "từ nay về sau" (đổi stack mặc định, thêm scope, đổi template, bỏ một
  bài) ghi vào `docs/nhat-ky-quyet-dinh.md` theo mẫu: ngày · quyết định · lý do · ảnh hưởng.

## 7. Sơ đồ (tóm tắt — chi tiết ở `references/quy-uoc-so-do.md`)

Dùng Mermaid vì GitHub render trực tiếp và diff được. Mỗi bài tối thiểu: một `flowchart` kiến trúc
(thành phần + luồng dữ liệu) và một `sequenceDiagram` cho luồng chính hoặc luồng lỗi. Nhãn tiếng
Việt, tên thành phần kỹ thuật giữ tiếng Anh. Tô màu phần thay đổi so với "trước khi áp dụng pattern"
để người đọc thấy ngay pattern thêm gì vào hệ thống.

## 8. Code (tóm tắt — chi tiết ở `references/quy-uoc-code.md`)

Stack mặc định: TypeScript strict trên Node 20+, NestJS khi cần HTTP app, Next.js cho frontend,
PostgreSQL, Redis, Docker Compose. Lý do: trùng stack đang dùng của người sở hữu repo nên bài học
chuyển thẳng vào công việc. Chọn khác được khi pattern đòi hỏi (ví dụ Go cho bài về gRPC), ghi lý
do ở mục 4 của README.

## 9. Checklist trước khi coi một việc là xong

- [ ] Tên thư mục và H1 đúng quy ước mục 5; bảng metadata có đủ 5 cột.
- [ ] Đủ 8 mục theo template; `node scripts/kiem-tra-readme.mjs` không báo lỗi.
- [ ] Mọi nguồn ở mục 7 nằm trong danh mục hoặc là tài liệu chính thức; nguồn chưa chắc ghi `(cần xác minh)`.
- [ ] Số liệu có nhãn "minh họa" / "đã đo"; không có kết quả "đã đạt" khi chưa đo.
- [ ] Có ≥ 1 flowchart và ≥ 1 sequenceDiagram; nhãn tiếng Việt.
- [ ] Mục 2 có bảng so sánh lựa chọn khác; mục 6 có "khi KHÔNG nên dùng".
- [ ] README scope đã có dòng tương ứng; `TIEN-DO.md` đã sinh lại.
- [ ] Quyết định mới (nếu có) đã vào nhật ký.

## 10. Tài liệu trong skill — đọc khi nào

| File | Đọc khi |
|---|---|
| `references/template-bai-toan.md` | Viết hoặc review README một bài toán |
| `references/template-scope.md` | Viết hoặc sửa README một scope |
| `references/quy-uoc-dat-ten.md` | Đặt tên thư mục, tiêu đề, mức độ, trạng thái |
| `references/quy-uoc-so-do.md` | Vẽ hoặc sửa sơ đồ Mermaid |
| `references/quy-uoc-code.md` | Bắt đầu code thực hành |
| `references/nguon-tham-khao.md` | Tìm/thêm nguồn trích dẫn (danh mục chuẩn) |
| `references/thuat-ngu.md` | Băn khoăn nên dịch hay giữ một thuật ngữ |
