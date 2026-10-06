# CLAUDE.md — design-patterns-practice

Repo thực hành design pattern giải bài toán doanh nghiệp ở tầng web application, **viết hoàn toàn
bằng tiếng Việt**, tên pattern giữ tiếng Anh.

## Bắt buộc trước khi làm bất cứ việc gì trong repo

1. Nạp skill `thuc-hanh-pattern` (`.claude/skills/thuc-hanh-pattern/SKILL.md`) — nó là bộ nhớ chung:
   quy ước đặt tên, template README 8 mục, quy ước sơ đồ/code, danh mục nguồn, quy tắc không bịa đặt.
2. Đọc `docs/nhat-ky-quyet-dinh.md` để không mở lại quyết định đã chốt.
3. Đọc README của scope liên quan — danh sách bài toán và nguồn ở đó là hợp đồng.

## Ba quy tắc ngắn

- **Không bịa đặt**: pattern và nguồn phải có trong `.claude/skills/thuc-hanh-pattern/references/nguon-tham-khao.md`
  hoặc là tài liệu chính thức; không chắc → ghi `(cần xác minh)`.
- **Số liệu có nhãn**: "minh họa" khi tưởng tượng, "đã đo" khi có số thật kèm môi trường.
- **Tên bài = `<Pattern> — <Triệu chứng kinh doanh>`**, thư mục `NN-<pattern-slug>-<trieu-chung-slug>`.

## Lệnh

```bash
node scripts/kiem-tra-readme.mjs   # lint cấu trúc README mọi bài (thoát 1 nếu lỗi)
node scripts/tao-tien-do.mjs       # sinh lại TIEN-DO.md
```

Code thực hành của một bài chạy bằng `docker compose up -d && pnpm install && pnpm test` trong thư mục bài.

## Khi kết thúc phiên

Chạy hai lệnh trên, cập nhật trạng thái/ngày trong bảng metadata của bài vừa làm, ghi quyết định mới
(nếu có) vào `docs/nhat-ky-quyet-dinh.md`.
