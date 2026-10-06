# Template README cho một bài toán

Sao chép nguyên khối dưới đây vào `README.md` của thư mục bài toán, thay phần trong `< >`.
Giữ nguyên **số thứ tự và tên 8 mục** vì `scripts/kiem-tra-readme.mjs` kiểm tra theo tên mục.
Độ dài hợp lý: 120–220 dòng. Dài hơn thường là dấu hiệu đang viết sách thay vì mô tả một bài.

Ghi chú cách viết từng mục nằm sau template.

---

```markdown
# <Tên pattern tiếng Anh> — <Triệu chứng bằng lời người kinh doanh>

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| <NN · scope / slug> | <🟢 Cơ bản \| 🟡 Trung bình \| 🔴 Nâng cao> | <📋 Kế hoạch \| 🔨 Đang làm \| ✅ Hoàn thành> | <Tên pattern — tác giả/nguồn gốc, năm> | <YYYY-MM-DD> |

> **Một câu tóm tắt:** <pattern này làm gì cho bài toán này, một câu>.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
<2–4 câu: loại doanh nghiệp, quy mô, hệ thống hiện tại.>

**Triệu chứng người kinh doanh nhìn thấy**
- <triệu chứng 1 — nói bằng ngôn ngữ kinh doanh: tiền, khách, thời gian>
- <triệu chứng 2>

**Nguyên nhân kỹ thuật**
<1 đoạn: chuyện gì đang xảy ra bên dưới.>

**Ràng buộc**
- <ràng buộc nghiệp vụ / kỹ thuật / chi phí mà giải pháp phải tôn trọng>

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** <1–2 câu>.

**Pattern giải quyết thế nào:** <1 đoạn, nói bằng cơ chế, không bằng khẩu hiệu>.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| <Giữ nguyên + tối ưu nhỏ> | ... | ... |
| <Pattern/kỹ thuật khác> | ... | ... |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  <sơ đồ thành phần; tô màu phần pattern thêm vào — xem quy-uoc-so-do.md>
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  <luồng thành công hoặc luồng lỗi mà pattern xử lý>
```

### 3.3 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| ... | ... | ... |

### 3.4 Điểm dễ sai khi triển khai
- <lỗi phổ biến 1 và cách tránh>
- <lỗi phổ biến 2>

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| ... | ... | ... | ... |

**Thay đổi so với hệ thống hiện tại:** <thêm thành phần nào, sửa chỗ nào, đội vận hành phải học gì>.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| ... | ... | ... | ... |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 8 kèm môi trường đo.

**Tác động nghiệp vụ mong đợi:** <1–2 câu nối chỉ số kỹ thuật với kết quả kinh doanh>.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- <chi phí / độ phức tạp / rủi ro mới mà pattern mang vào>

**Không nên dùng khi**
- <điều kiện mà pattern là thừa hoặc có hại>

**Liên quan**
- <bài toán khác trong repo nên đọc trước/sau, dạng đường dẫn tương đối>

## 7. Cơ sở tham khảo

- <Tác giả, "Tên tài liệu", nơi xuất bản, năm — URL nếu có> — <một dòng: tài liệu này nói gì về pattern>
- <Tài liệu chính thức của công nghệ dùng ở mục 4>
- <Case study công khai nếu có; nguồn chưa chắc ghi (cần xác minh)>

## 8. Kế hoạch thực hành

- [ ] <Bước 1: dựng hạ tầng tối thiểu để tái hiện triệu chứng>
- [ ] <Bước 2: đo "trước">
- [ ] <Bước 3: áp dụng pattern>
- [ ] <Bước 4: đo "sau", ghi vào mục 5>
- [ ] <Bước 5: viết test chứng minh hành vi cốt lõi của pattern>

**Cấu trúc code dự kiến**
```text
src/
  ...
test/
docker-compose.yml
```

**Cách chạy** *(điền khi bắt đầu code)*
```bash
docker compose up -d
pnpm install && pnpm test
```
```

---

## Ghi chú cách viết

**Tiêu đề và câu tóm tắt.** Người đọc lướt danh sách sẽ chỉ đọc H1. Nửa đầu là tên pattern để tra cứu,
nửa sau là triệu chứng để nhận ra "à, mình gặp cái này rồi". Tránh triệu chứng chung chung
("hệ thống chậm"); chọn một cảnh cụ thể ("trang 500 của lịch sử giao dịch mất 6 giây").

**Mục 1 (What).** Viết cho người kinh doanh đọc được toàn bộ mục này. Nguyên nhân kỹ thuật là
cầu nối sang mục 2. Số liệu để tạo hình dung — luôn kèm nhãn minh họa.

**Mục 2 (Why).** Phần quan trọng nhất về tư duy. Bảng lựa chọn khác buộc ta chứng minh pattern là
lựa chọn có cân nhắc, không phải "thấy hay thì dùng". Luôn có một dòng "giữ nguyên và tối ưu nhỏ".

**Mục 3 (How).** Sơ đồ trước/sau cho thấy pattern *thêm* gì. Sequence diagram cho luồng mà pattern
thực sự xử lý (thường là luồng lỗi: timeout, trùng, mất mạng). Mục 3.4 là nơi ghi kinh nghiệm
triển khai — giá trị nhất khi đã làm thật.

**Mục 4 (Tech stack).** Cột "vì sao chọn" phải nói về đặc tính kỹ thuật phù hợp bài toán, không
phải "phổ biến". Cột "thay thế" giúp người ở stack khác vẫn dùng được bài.

**Mục 5 (Impact).** Mỗi chỉ số phải đo được bằng công cụ nêu ở cột "cách đo" (k6, EXPLAIN ANALYZE,
Prometheus, log...). Nếu không biết đo thế nào, chỉ số đó chưa đủ tốt để ghi.

**Mục 6.** "Khi KHÔNG nên dùng" là bằng chứng ta hiểu pattern; thiếu mục này README thành bài PR.

**Mục 7.** Ưu tiên theo thứ tự: tài liệu của tác giả gốc → spec/RFC/docs chính thức → sách tổng hợp
→ case study công khai → bài blog. Mỗi nguồn kèm một dòng nói nó đóng góp gì cho bài.

**Mục 8.** Kế hoạch đủ cụ thể để một phiên Claude Code khác làm tiếp không cần hỏi lại.

**Sau khi hoàn thành (✅)** thêm mục cuối: `## Bài học sau khi làm` — điều gì khác với dự đoán,
số đo thật, điều sẽ làm khác lần sau.
