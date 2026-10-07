# Nhật ký quyết định

Bộ nhớ dài hạn của repo. Mỗi quyết định "từ nay về sau" ghi một mục: ngày · quyết định · lý do ·
ảnh hưởng. Phiên làm việc sau đọc file này trước để không mở lại điều đã chốt. Muốn đảo một quyết
định: thêm mục mới dẫn tới mục cũ, không xóa mục cũ.

## 2026-10-06 — Khởi tạo repo và chốt khung

**Quyết định**
1. 24 scope theo đúng danh sách đề bài; slug thư mục tiếng Anh không dấu, số thứ tự `01`–`24`.
2. Tên bài toán = `<Pattern tiếng Anh> — <Triệu chứng bằng lời người kinh doanh>`; thư mục
   `NN-<pattern-slug>-<trieu-chung-slug>`.
3. README bài toán có đúng 8 mục (What / Why / How / Tech stack / Impact / Đánh đổi / Nguồn / Kế hoạch),
   lint bằng `scripts/kiem-tra-readme.mjs`.
4. Mọi pattern phải truy được về nguồn trong danh mục chuẩn của skill; nguồn chưa chắc ghi `(cần xác minh)`.
5. Số liệu trong bối cảnh gắn nhãn "minh họa"; kết quả chỉ ghi khi "đã đo" kèm môi trường.
6. Bối cảnh là doanh nghiệp giả định theo lĩnh vực; không dùng tên công ty thật làm bối cảnh.
7. Sơ đồ bằng Mermaid; tối thiểu một flowchart và một sequenceDiagram mỗi bài.
8. Stack mặc định: TypeScript strict, Node 20+, NestJS/Fastify, Next.js, PostgreSQL 16, Redis 7,
   Docker Compose, Vitest, k6, Anthropic SDK (model mặc định `claude-opus-5-5`).
9. `TIEN-DO.md` chỉ sinh bằng script, không sửa tay.
10. Skill `thuc-hanh-pattern` đặt trong repo (`.claude/skills/`) để mọi phiên Claude Code đọc chung.

**Lý do**
- Người sở hữu repo đang làm NestJS + Kysely + PostgreSQL + PGMQ + Turborepo và Next.js; stack trùng
  giúp bài học chuyển thẳng vào công việc.
- Đặt tên theo triệu chứng giúp người kinh doanh và kỹ sư cùng nhận ra bài toán; giữ tên pattern
  tiếng Anh để tra được tài liệu gốc.
- Yêu cầu "không bịa đặt" là ràng buộc gốc của repo, nên danh mục nguồn và nhãn số liệu được đưa vào
  template và lint thay vì chỉ dặn dò.

**Ảnh hưởng**
- Thêm scope mới hoặc đổi template là quyết định phải ghi ở đây trước khi làm.
- Agent/phiên viết README bài toán chỉ được dùng pattern và nguồn đã liệt kê trong README scope hoặc
  danh mục nguồn.

## 2026-10-06 — Rate limiting đặt ở scope 13, không ở scope 03

**Quyết định:** Bài "Rate Limiting & Throttling" nằm trong `13-backend-transporter`; scope `03-backend-cache`
chỉ liên kết tới.
**Lý do:** Vấn đề kinh doanh (một khách API làm chậm khách khác) là vấn đề ở biên API; Redis chỉ là nơi
lưu bộ đếm.
**Ảnh hưởng:** Bài ở scope 03 về hot key / distributed lock dẫn chéo sang bài này khi cần bộ đếm phân tán.

## 2026-10-06 — Model Routing/Cascade đặt ở scope 22, scope 20 chỉ liên kết

**Quyết định:** Bài routing theo chi phí (FrugalGPT, RouteLLM) nằm trong `22-backend-ai-optimizer`.
**Lý do:** Mục tiêu chính của bài là chi phí; scope 20 tập trung vào cấu trúc framework.
**Ảnh hưởng:** Scope 20 có bài "Model Gateway" (trừu tượng hóa provider) làm nền cho routing ở scope 22.

## 2026-10-06 — Ngoại lệ về ngôn ngữ và tên file trong code thực hành

**Quyết định**
1. Bài cần thống kê, huấn luyện hoặc lượng tử hóa (ví dụ 22/08, 22/09, 24/08) được phép dùng Python thay cho TypeScript; lý do ghi ở mục 4 của bài.
2. Tên file Python dùng `snake_case` khi file được import hoặc pytest tự tìm (ví dụ `drift_tests.py`); file chạy như script đơn lẻ giữ kebab-case.
3. Bài 21/05: Anthropic không có API embedding, bước embed dùng Text Embeddings Inference; Message Batches chỉ dùng cho bước sinh ngữ cảnh chunk.
4. Bài 04/02 dùng Vite SPA thay cho Next.js, vì Next.js đã tự băm tên file tĩnh nên không tái hiện được triệu chứng cache cũ.

**Lý do:** Ghi lại lệch khỏi stack mặc định để phiên sau không "sửa cho đồng nhất" nhầm.
**Ảnh hưởng:** Quy ước trong `references/quy-uoc-code.md` giữ nguyên; các ngoại lệ trên đứng cạnh nó.

## 2026-10-06 — Đính chính nguồn: DDIA ch.3 không bàn write-back

**Quyết định:** Bài 03/04 trích DDIA ch.7 (durability) và ch.5 (read-your-writes), không trích ch.3 (Storage and Retrieval).
**Lý do:** ch.3 nói về cấu trúc lưu trữ, không bàn cache write-back; nguồn trong bảng scope ban đầu ghi sai chương.

## 2026-10-06 — Quy ước cho code thực hành (rút ra từ bài đầu tiên 02/01)

**Quyết định**
1. Mỗi bài thực hành là một project pnpm độc lập nằm ngay trong thư mục bài (có `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`); repo gốc không dùng workspace.
2. Cổng hạ tầng của lab không dùng cổng mặc định (Postgres `55432`, không `5432`) để không đụng container của dự án khác trên máy; ghi cổng trong `docker-compose.yml` và `.env.example`.
3. Số đo thô của k6 ghi vào `bench/results/` và KHÔNG commit (`.gitignore` của bài); chỉ số đã chọn lọc, kèm môi trường đo, ghi vào mục 5.1 của README bài.
4. Lab nhỏ dùng Fastify thay NestJS khi chỉ cần vài route; ghi lý do ở mục 4 của README bài.
5. Seed nhỏ hơn quy mô trong mục 1 (laptop) là chấp nhận được nếu ghi rõ tỉ lệ và các hạn chế ở mục 5.1.
6. Test tích hợp không giả định nội dung "trang đầu" khi có ghi song song; nhắm bản ghi cụ thể.

**Lý do:** Bài 02/01 là bài đầu tiên chạy thật; các quy ước trên tránh va chạm cổng, giữ repo gọn và giữ số đo trung thực.
**Ảnh hưởng:** Bài thực hành sau theo cùng khung; `references/quy-uoc-code.md` giữ nguyên, các điểm trên bổ sung cho nó.

## 2026-10-07 — Quy ước đo rút ra từ bài 02/02 (Optimistic Offline Lock)

**Quyết định**
1. Script k6 gọi URL có id phải đặt tag `name` cố định cho từng endpoint (ví dụ `PATCH /shipments/:id`). Không đặt thì k6 tạo một chuỗi số liệu cho mỗi id (bài 02/02 vượt 100.000 chuỗi), tốn RAM/CPU ngay trên máy đang chạy API và làm bẩn số đo.
2. Khi so một overhead nhỏ (cỡ ≤ 1 ms) giữa hai cách làm: chạy nhiều vòng (bài 02/02 dùng 5), xoay thứ tự giữa các vòng, ghi trung vị kèm thấp nhất – cao nhất và chênh lệch theo từng vòng. Chênh lệch nhỏ hơn dao động giữa các vòng thì ghi "không thấy vượt mức nhiễu", không ghi như một con số chính xác.
3. Ngoại lệ của bài 02/02: không dựng frontend Next.js; màn hình gộp được thay bằng hàm gộp ba phía `mergeShipmentForm` có test, vì chỉ số của bài nằm ở phía API/DB.

**Lý do:** Lượt đo k6 đầu của bài 02/02 phải bỏ vì lỗi (1); chênh p95 giữa `UPDATE ... WHERE id` và `UPDATE ... WHERE id AND version` nhỏ hơn dao động giữa các vòng (2).
**Ảnh hưởng:** Script k6 của các bài sau theo (1); mục 5.1 của bài có chỉ số overhead theo (2); phiên sau không "bổ sung" frontend cho bài 02/02 trừ khi được yêu cầu.
