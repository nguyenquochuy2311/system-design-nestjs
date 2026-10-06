# Thực hành Design Pattern cho bài toán doanh nghiệp ở tầng web application

> Mỗi bài trong repo là **một vấn đề thật mà doanh nghiệp gặp** — trừ tiền hai lần, cache sập lúc
> flash sale, chatbot bịa, hóa đơn AI tăng gấp ba — được giải bằng **một pattern có tên và có nguồn
> gốc**, mô tả theo cùng một khung **What → Why → How → Tech stack → Impact → Nguồn**, kèm sơ đồ
> Mermaid và code thực hành đo được.
>
> Viết hoàn toàn bằng tiếng Việt. Tên pattern giữ tiếng Anh để tra được tài liệu gốc.

## Repo này khác gì một cuốn sách pattern

Học pattern từ sách thường dừng ở "biết tên, không biết dùng khi nào". Repo đảo thứ tự: **bắt đầu từ
triệu chứng** người kinh doanh nhìn thấy, truy ra nguyên nhân kỹ thuật, rồi mới gọi tên pattern, và
luôn trả lời "lựa chọn khác là gì, vì sao không chọn, khi nào không nên dùng".

Ba cam kết:

1. **Có cơ sở.** Mọi pattern truy được về tác giả gốc, spec, docs chính thức hoặc paper
   (danh mục: [`nguon-tham-khao.md`](.claude/skills/thuc-hanh-pattern/references/nguon-tham-khao.md)).
   Nguồn chưa chắc được đánh dấu `(cần xác minh)`, không giả vờ đã kiểm.
2. **Số liệu có nhãn.** Số trong bối cảnh là *minh họa*; số trong kết quả chỉ được tính khi *đã đo*
   kèm môi trường đo.
3. **Nhìn thấy được.** Mỗi bài có sơ đồ kiến trúc trước/sau và sequence diagram cho luồng mà pattern
   thực sự xử lý.

## Cách đọc một bài

Tên bài luôn có dạng **`<Pattern> — <Triệu chứng bằng lời người kinh doanh>`**, ví dụ:

> *Idempotency Key — Khách bấm "Thanh toán" hai lần vì mạng chập chờn, bị trừ tiền hai lần*

Nửa trước để kỹ sư tra cứu; nửa sau để người kinh doanh nhận ra "mình gặp cái này rồi". README của
bài đi theo 8 mục cố định:

| Mục | Trả lời câu hỏi |
|---|---|
| 1. Bài toán thực tế (What) | Chuyện gì đang xảy ra, ai đau, ràng buộc gì |
| 2. Vì sao dùng pattern này (Why) | Nguyên nhân gốc; pattern xử lý ra sao; lựa chọn khác và vì sao không chọn |
| 3. Thiết kế hệ thống (How) | Sơ đồ trước/sau, luồng chính, thành phần, điểm dễ sai |
| 4. Tech stack và tác động | Chọn công nghệ gì, vì sao, thay thế bằng gì, đội vận hành đổi gì |
| 5. Kết quả đầu ra và cách đo | Chỉ số nào, đo bằng gì, mục tiêu bao nhiêu |
| 6. Đánh đổi và khi KHÔNG nên dùng | Chi phí mới, rủi ro mới, điều kiện pattern là thừa |
| 7. Cơ sở tham khảo | Nguồn gốc pattern, docs, case study |
| 8. Kế hoạch thực hành | Các bước code, cấu trúc thư mục, cách chạy |

Mức độ: 🟢 Cơ bản · 🟡 Trung bình · 🔴 Nâng cao. Trạng thái: 📋 Kế hoạch · 🔨 Đang làm · ✅ Hoàn thành.
Tiến độ toàn repo: [`TIEN-DO.md`](TIEN-DO.md) (sinh tự động).

## 24 scope

| # | Scope (theo đề bài) | Tên tiếng Việt | Câu hỏi trung tâm |
|---|---|---|---|
| 01 | frontend / backend / transporter | [Giao tiếp Frontend ↔ Backend](01-frontend-backend-transporter/) | Frontend và backend nói chuyện bằng hợp đồng nào để không hiểu nhầm nhau và không gửi thừa? |
| 02 | backend / database | [Cơ sở dữ liệu quan hệ](02-backend-database/) | Làm sao DB vẫn đúng và vẫn nhanh khi dữ liệu, người dùng và yêu cầu nghiệp vụ cùng lớn lên? |
| 03 | backend / cache | [Cache phía backend](03-backend-cache/) | Cache ở đâu, làm mới thế nào, và chuyện gì xảy ra khi cache sai hoặc biến mất? |
| 04 | frontend / cache | [Cache phía frontend](04-frontend-cache/) | Trình duyệt giữ gì, giữ bao lâu, và làm sao người dùng không thấy dữ liệu cũ hay vòng xoay loading? |
| 05 | backend / search | [Tìm kiếm](05-backend-search/) | Tìm đúng thứ người dùng *muốn* (không chỉ thứ họ *gõ*) trên hàng triệu bản ghi, dưới 100 ms? |
| 06 | frontend / backend / realtime | [Thời gian thực](06-frontend-backend-realtime/) | Đẩy thay đổi tới đúng người, đúng thứ tự, kể cả khi họ mất mạng và server chạy nhiều bản? |
| 07 | backend / microservices | [Microservices](07-backend-microservices/) | Khi một quy trình nghiệp vụ trải qua nhiều service, làm sao vẫn đúng khi một service hỏng? |
| 08 | backend / monolithics | [Monolith](08-backend-monolith/) | Giữ một codebase lớn vẫn dễ sửa, dễ test, dễ tách sau này, không cần microservices sớm? |
| 09 | backend / monorepo | [Monorepo](09-backend-monorepo/) | Nhiều ứng dụng và thư viện trong một repo: chia sẻ code mà CI không chậm và ranh giới không vỡ? |
| 10 | backend / AI RAG | [AI — RAG](10-backend-ai-rag/) | Để model trả lời từ tài liệu của doanh nghiệp một cách đúng, có dẫn nguồn, đúng quyền, và đo được? |
| 11 | backend / AI Agent | [AI — Agent](11-backend-ai-agent/) | Khi nào cần agent thật, và làm sao để agent dùng tool, nhớ ngữ cảnh, không bị lừa, có người duyệt? |
| 12 | backend / database / vector | [Cơ sở dữ liệu vector](12-backend-database-vector/) | Tìm "giống nhau" trên hàng chục triệu vector với recall, độ trễ và RAM chấp nhận được? |
| 13 | backend / transporter | [Giao tiếp giữa các service](13-backend-transporter/) | Service nói chuyện với service (và với đối tác) bằng giao thức nào, tiến hóa schema và chịu lỗi ra sao? |
| 14 | backend / queueing / message queueing | [Hàng đợi và message queue](14-backend-queueing/) | Tách việc ra khỏi request mà không mất message, không xử lý trùng, không sai thứ tự? |
| 15 | backend / storage | [Lưu trữ file và object](15-backend-storage/) | File đi đâu, ai được tải, upload lớn không nghẽn API, chi phí và backup kiểm soát thế nào? |
| 16 | backend / k8s | [Kubernetes](16-backend-k8s/) | Deploy không rớt request, scale theo tải, cấu hình và bí mật an toàn, release giảm rủi ro? |
| 17 | backend / docker | [Docker](17-backend-docker/) | Image nhỏ, build nhanh, chạy an toàn, tắt sạch, và "trên máy em chạy được" không còn là lý do? |
| 18 | backend / vertical / horizontal scale | [Mở rộng dọc và ngang](18-backend-scale/) | Nâng máy hay thêm máy, theo thứ tự nào, và làm gì khi tải vượt mọi dự tính? |
| 19 | backend / frontend / authenticate | [Xác thực và phân quyền](19-backend-frontend-authenticate/) | Ai là ai, họ được làm gì, token nằm ở đâu, và chuyện gì xảy ra khi token bị đánh cắp? |
| 20 | backend / AI framework system design | [Thiết kế hệ thống AI framework](20-backend-ai-framework-system-design/) | Xây lớp nền cho ứng dụng LLM: từ gọi model có kiểm soát tới workflow bền, có eval, có guardrail? |
| 21 | backend / AI infrastructure | [Hạ tầng AI](21-backend-ai-infrastructure/) | Gọi API hay tự host, GPU dùng ra sao, gateway quản lý chi phí thế nào, mất provider thì sao? |
| 22 | backend / AI optimizer | [Tối ưu AI](22-backend-ai-optimizer/) | Giảm chi phí và độ trễ của tính năng AI mà chất lượng không tụt, đo bằng gì? |
| 23 | backend / monitoring benchmark | [Giám sát và benchmark](23-backend-monitoring-benchmark/) | Biết hệ thống đang ổn hay không bằng số, tìm ra chỗ chậm, và benchmark không tự lừa mình? |
| 24 | backend / AI monitoring | [Giám sát AI](24-backend-ai-monitoring/) | Theo dõi chất lượng, chi phí, độ trễ và an toàn của tính năng AI trong production? |

Lộ trình học xuyên scope: [`docs/lo-trinh-hoc.md`](docs/lo-trinh-hoc.md).

## Bối cảnh giả định dùng xuyên suốt

Bài toán lấy từ các lĩnh vực quen thuộc ở Việt Nam: **sàn thương mại điện tử, ví điện tử, bảo hiểm,
đấu giá trực tuyến, logistics, CRM nội bộ, SaaS B2B**. Doanh nghiệp trong bài là giả định; chỉ phần
"Cơ sở tham khảo" mới nêu tên công ty thật kèm đúng bài viết công khai của họ.

## Stack mặc định khi thực hành

TypeScript (strict) · Node 20+ · NestJS / Fastify · Next.js · PostgreSQL 16 · Redis 7 · Docker Compose
· Vitest · k6 · Anthropic SDK cho các scope AI. Bài nào cần khác (Go cho gRPC, cluster cho service
mesh) ghi lý do trong mục 4. Chi tiết: [`quy-uoc-code.md`](.claude/skills/thuc-hanh-pattern/references/quy-uoc-code.md).

## Dành cho Claude Code

Repo có skill [`thuc-hanh-pattern`](.claude/skills/thuc-hanh-pattern/SKILL.md) giữ ngữ cảnh chung
(template, quy ước, nguồn, quy tắc không bịa đặt) để mọi phiên làm việc viết cùng một giọng.
[`CLAUDE.md`](CLAUDE.md) tóm tắt việc phải làm đầu và cuối phiên.
[`docs/nhat-ky-quyet-dinh.md`](docs/nhat-ky-quyet-dinh.md) là bộ nhớ dài hạn về các quyết định đã chốt.

```bash
node scripts/kiem-tra-readme.mjs   # lint cấu trúc README mọi bài
node scripts/tao-tien-do.mjs       # sinh lại TIEN-DO.md
```

## Cấu trúc

```text
NN-<scope>/
├── README.md                          # bản đồ pattern + bảng bài toán + lộ trình trong scope
└── NN-<pattern>-<trieu-chung>/
    ├── README.md                      # 8 mục theo template
    ├── src/  test/  bench/            # khi thực hành
    └── docker-compose.yml
```
