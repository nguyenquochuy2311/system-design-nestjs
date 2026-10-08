# Password Hashing (Argon2id / bcrypt) — Lộ DB là lộ toàn bộ mật khẩu vì lưu MD5

| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |
|---|---|---|---|---|
| 19 · backend / frontend / authenticate | 🟢 Cơ bản | ✅ Hoàn thành | Argon2id — RFC 9106 (2021); OWASP "Password Storage Cheat Sheet" | 2026-10-09 |

> **Một câu tóm tắt:** Lưu mật khẩu bằng hàm băm chuyên dụng, chậm và tốn bộ nhớ (Argon2id, dự phòng bcrypt) với salt riêng từng người, để một bản sao DB bị lộ không biến thành danh sách mật khẩu dùng được — và nâng cấp hash cũ dần theo từng lần đăng nhập mà không cần biết mật khẩu gốc.

## 1. Bài toán thực tế (What)

**Bối cảnh** *(doanh nghiệp giả định, số liệu minh họa)*
Sàn thương mại điện tử 1,8 triệu tài khoản, hệ thống viết từ 2015, cột `users.password` lưu `MD5(mật khẩu)` không salt — "hồi đó ai cũng làm thế". Một bản backup DB bị lộ qua bucket lưu trữ cấu hình sai quyền. Ba ngày sau, diễn đàn rao bán "1,8 triệu email + mật khẩu dạng rõ" của sàn.

**Triệu chứng người kinh doanh nhìn thấy**
- Khách báo bị đăng nhập lạ, đổi địa chỉ nhận hàng, tiêu điểm tích lũy; đội chăm sóc khách hàng nhận ~300 ticket/ngày trong tuần đầu.
- Phải ép 1,8 triệu người đổi mật khẩu cùng lúc; tỷ lệ quay lại sau sự cố sụt, phát sinh chi phí truyền thông và pháp lý.
- Khách dùng lại mật khẩu ở ngân hàng/ví điện tử bị thiệt hại ở nơi khác và quy trách nhiệm cho sàn — rủi ro uy tín lớn hơn thiệt hại trực tiếp.

**Nguyên nhân kỹ thuật**
MD5 là hàm băm thiết kế để *nhanh*: phần cứng phổ thông thử được hàng tỷ ứng viên mỗi giây. Không có salt nên hai người cùng mật khẩu có cùng hash, và bảng tra sẵn (rainbow table) dùng được cho mọi tài khoản. Hậu quả: có file hash là coi như có mật khẩu rõ của phần lớn người dùng chỉ sau vài giờ.

**Ràng buộc**
- Không có mật khẩu gốc để băm lại hàng loạt; chỉ "gặp" mật khẩu khi người dùng đăng nhập.
- Đăng nhập không được chậm thêm quá ~300 ms ở p95; API chạy trên pod 1 vCPU / 1 GB RAM (minh họa).
- Phải tương thích luồng đăng nhập và đặt lại mật khẩu hiện tại; không ép đổi mật khẩu toàn bộ lần thứ hai.

## 2. Vì sao dùng pattern này (Why)

**Nguyên nhân gốc mà pattern nhắm vào:** chi phí để kẻ tấn công *thử một mật khẩu* quá rẻ, và một lần thử đúng cho một người lại áp dụng được cho mọi người có cùng mật khẩu.

**Pattern giải quyết thế nào:** dùng *password hashing function* — hàm băm có tham số chi phí điều chỉnh được (bộ nhớ, số vòng, độ song song) và salt ngẫu nhiên riêng từng tài khoản. Argon2id (RFC 9106) là hàm *memory-hard*: mỗi lần tính cần vài chục MiB RAM, nên GPU/ASIC không còn lợi thế hàng nghìn lần như với MD5; bcrypt là phương án dự phòng đã được kiểm chứng lâu năm khi không dùng được Argon2. Chuỗi hash lưu kèm thuật toán và tham số (dạng PHC string `$argon2id$v=19$m=...,t=...,p=...$salt$hash`) nên có thể tăng chi phí theo thời gian và nhận ra hash "cũ" cần nâng cấp. Với dữ liệu MD5 đang có, OWASP mô tả hai cách bổ sung nhau: *bọc* ngay toàn bộ (`argon2id(md5_cũ)`) để đóng lỗ hổng tức thời, rồi *băm lại* bằng mật khẩu thật ở lần đăng nhập kế tiếp.

**Lựa chọn khác đã cân nhắc**

| Lựa chọn | Giải quyết được gì | Vì sao không chọn (ở bài này) |
|---|---|---|
| Giữ nguyên + tối ưu nhỏ (thêm salt vào MD5, ép mật khẩu dài hơn) | Vô hiệu rainbow table; cùng mật khẩu khác hash | MD5 có salt vẫn thử được hàng tỷ lần/giây; chỉ kéo thời gian bẻ từ giờ sang ngày |
| SHA-256 lặp nhiều vòng tự chế | Chậm hơn MD5 | Không memory-hard, tự thiết kế dễ sai; đã có PBKDF2/bcrypt/Argon2 được phân tích công khai |
| bcrypt | Chậm, có salt, thư viện mọi ngôn ngữ | Vẫn là dự phòng tốt; nhược điểm: giới hạn 72 byte đầu vào, không memory-hard |
| scrypt | Memory-hard, có sẵn trong `node:crypto` | Tham số khó chỉnh hơn Argon2id; OWASP xếp sau Argon2id |
| Ép toàn bộ người dùng đặt lại mật khẩu, giữ MD5 | Vô hiệu dữ liệu đã lộ | Không sửa cách lưu — lần lộ sau lặp lại y nguyên |
| Bỏ mật khẩu: chỉ đăng nhập qua Google/Zalo hoặc passkey | Không còn hash để lộ | Không áp được cho toàn bộ khách hiện tại; là hướng dài hạn ở bài 03 và 08 |

## 3. Thiết kế hệ thống (How)

### 3.1 Kiến trúc trước và sau

```mermaid
flowchart LR
  classDef moi fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef cu fill:#F1F5F9,stroke:#64748B,color:#0F172A
  classDef loi fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  subgraph TRUOC["Trước — MD5 không salt"]
    C1["Client"]:::cu --> A1["API đăng nhập<br/>so sánh md5(pw) với cột"]:::loi --> D1[("users.password<br/>MD5, không salt")]:::loi
  end

  subgraph SAU["Sau — Argon2id + nâng cấp dần"]
    C2["Client"]:::cu --> A2["API đăng nhập"]:::cu --> H["PasswordHasher<br/>Argon2id, salt riêng, pepper"]:::moi
    H --> D2[("users.password_hash<br/>PHC string + hash_version")]:::moi
    A2 --> R["Redis<br/>bộ đếm đăng nhập sai"]:::moi
    K["Pepper<br/>biến môi trường hoặc KMS"]:::moi -.-> H
  end
```

### 3.2 Luồng chính

```mermaid
sequenceDiagram
  autonumber
  participant U as Người dùng
  participant API as API đăng nhập
  participant H as PasswordHasher
  participant DB as PostgreSQL
  U->>API: POST /login với email + mật khẩu
  API->>DB: đọc password_hash, hash_version theo email
  DB-->>API: hash_version = 1 — argon2id bọc md5
  alt hash_version = 1 — hash cũ đã bọc
    API->>H: verify argon2id của md5 mật khẩu
    H-->>API: đúng
    API->>H: băm mật khẩu bằng Argon2id tham số hiện hành
    H-->>API: PHC string mới
    API->>DB: UPDATE password_hash, hash_version = 2
    Note over API,DB: Nâng cấp "cơ hội" — không cần biết mật khẩu trước đó
  else hash_version = 2 — Argon2id trực tiếp
    API->>H: verify password_hash với mật khẩu
    H-->>API: đúng hoặc sai
  end
  API-->>U: phiên đăng nhập, hoặc lỗi chung "email hoặc mật khẩu không đúng"
```

### 3.3 Thành phần và trách nhiệm

| Thành phần | Trách nhiệm | Quyết định thiết kế đáng chú ý |
|---|---|---|
| `PasswordHasher` | `hash`, `verify`, `needsRehash` bọc thư viện Argon2id | Tham số đặt ở một chỗ, đọc từ cấu hình; đo lại trên máy đích mỗi khi đổi hạ tầng |
| `LegacyHashAdapter` | Xác minh hash_version = 1 bằng `argon2id(md5(pw))` | Chỉ tồn tại trong giai đoạn di trú; xóa khi tài khoản hoạt động đã nâng cấp hết |
| Migration một lần | Bọc toàn bộ hash MD5 hiện có bằng Argon2id | Chạy theo lô, tiếp tục được khi gián đoạn; đóng lỗ hổng ngay đêm đầu |
| Pepper | Khóa bí mật ngoài DB trộn vào trước khi băm (HMAC) hoặc mã hóa hash sau khi băm | Lộ DB mà không lộ pepper thì hash vô dụng; xoay pepper cần kế hoạch riêng |
| Bộ đếm đăng nhập sai (Redis) | Giới hạn thử mật khẩu online theo tài khoản và IP | Hash chậm chỉ bảo vệ offline; online phải có throttling (scope 13 bài 03) |
| Cột `hash_version` | Cho biết tài khoản nào còn hash cũ | Đo tiến độ di trú bằng một câu SQL |

### 3.4 Điểm dễ sai khi triển khai
- Lấy tham số mặc định của thư viện rồi không đo trên máy đích: pod 1 vCPU có thể mất 1–2 giây/hash, tự làm DoS khi 50 người đăng nhập cùng lúc. Đo trước, chọn tham số cho ~100–300 ms.
- Tính hash trong event loop của Node làm chặn toàn bộ request khác. Thư viện `argon2` chạy trên threadpool của libuv; vẫn cần giới hạn số hash đồng thời.
- Dùng bcrypt mà quên giới hạn 72 byte: phần sau của mật khẩu dài bị bỏ qua âm thầm. Argon2id không có giới hạn này.
- Thông báo lỗi khác nhau cho "email không tồn tại" và "sai mật khẩu" làm lộ danh sách tài khoản; thời gian phản hồi cũng phải tương đương (băm một hash giả khi email không tồn tại).
- Tự so sánh hash bằng `===` thay vì dùng `verify` của thư viện (so sánh thời gian cố định).
- Cắt ngắn mật khẩu hoặc cấm ký tự đặc biệt "cho an toàn": giảm entropy mà không có lợi gì cho hash.
- Quên đưa luồng *đặt lại mật khẩu* và *đổi mật khẩu* qua cùng `PasswordHasher` — hash mới sinh vẫn theo cách cũ.

**Gặp thật khi làm lab (xem mục 5.1 và nhật ký 19/01):**
- **Migration và nâng cấp phải XÓA hash cũ cùng lúc.** Bọc `argon2id(md5)` mà vẫn giữ nguyên cột `password_md5` thì một bản dump sau migration VẪN lộ 85 % mật khẩu qua cột MD5 không salt — "đã áp pattern" nhưng chưa đóng lỗ. Phải `password_md5 = NULL` ngay trong câu `UPDATE` bọc và trong `rehash` khi đăng nhập. (Lỗi này lọt qua 12 test và 4 phép thử âm ban đầu vì chúng chỉ kiểm cột `password_hash`; chỉ lộ khi dump cả bảng lúc kiểm đầu cuối. Script tấn công cũng phải thử MỌI cột của dump, không chỉ cột hash mới.)
- Prebuilt của `argon2` (node-argon2 `0.45.1`) cho `darwin-arm64` lại là binary Linux → `require` làm Node thoát mã 139 (SIGSEGV). Lab dùng `@node-rs/argon2` (napi-rs, có gói nền tảng riêng), ghim `2.2.2`; gói này không có `needsRehash` nên tự parse chuỗi PHC để so tham số, pepper truyền qua tùy chọn `secret`.
- NestJS chạy bằng `tsx` (esbuild) không phát metadata `design:paramtypes`, phải `@Inject(<lớp>)` tường minh mọi tham số constructor; test Vitest (oxc) vẫn tiêm được theo kiểu nên lỗi bị ẩn tới khi chạy app thật (nhật ký 08/01 điểm 1).
- Argon2 chạy trên threadpool của libuv: `UV_THREADPOOL_SIZE` giới hạn số hash song song và trần thông lượng của `/login`.

## 4. Tech stack và tác động (Impact techstack)

| Lớp | Công nghệ chọn | Vì sao chọn | Thay thế tương đương |
|---|---|---|---|
| Ngôn ngữ / runtime | TypeScript strict, Node 20+ | Stack mặc định của repo | — |
| HTTP app | NestJS | Module `auth` tách riêng, DI để thay hasher trong test | Fastify thuần |
| Hàm băm | `argon2` (node-argon2, binding C của libargon2) | Argon2id theo RFC 9106; chạy ngoài event loop; xuất PHC string | `bcrypt` (npm) khi không build được binding native; `crypto.scrypt` có sẵn trong Node |
| Dữ liệu | PostgreSQL 16 | Cột `password_hash text`, `hash_version smallint`; migration theo lô | MySQL/MariaDB |
| Giới hạn thử | Redis 7 | Bộ đếm đăng nhập sai với TTL | Bảng PostgreSQL nếu lưu lượng nhỏ |
| Đo | Script benchmark Node, k6, Vitest | Đo thời gian hash theo tham số; đo p95 đăng nhập dưới tải; test hành vi | — |
| Hạ tầng local | Docker Compose | Dựng Postgres + Redis một lệnh | — |

**Thay đổi so với hệ thống hiện tại:** thêm module `PasswordHasher` và adapter hash cũ; thêm cột `hash_version`; một migration bọc toàn bộ hash cũ; đội vận hành học cách đo và chỉnh tham số Argon2 khi đổi loại máy, cách quản lý và xoay pepper.

## 5. Kết quả đầu ra và cách đo (Output impact)

| Chỉ số | Trước (minh họa) | Mục tiêu khi thực hành | Cách đo |
|---|---|---|---|
| Chi phí thử 1 ứng viên mật khẩu offline | MD5: hàng tỷ lần/giây trên GPU phổ thông | Argon2id: ~100 ms CPU + hàng chục MiB RAM mỗi lần, GPU không tăng tốc đáng kể | Benchmark Node đo `hash` 1.000 lần với tham số đã chọn, ghi rõ CPU/RAM máy đo |
| Hai tài khoản cùng mật khẩu → hash giống nhau | Có | Không | Test Vitest: băm cùng mật khẩu hai lần, kết quả khác nhau |
| Thời gian `verify` p95 trên máy đích | ~0 ms | 100–300 ms | Benchmark trên pod cùng cấu hình production |
| Độ trễ `POST /login` p95 với 50 người đăng nhập đồng thời | ~40 ms | ≤ trước + 300 ms, không timeout | k6, kịch bản 50 VU trong 2 phút |
| Tài khoản còn hash cũ sau 30 / 90 ngày | 100% | Theo dõi giảm dần | `SELECT hash_version, count(*) FROM users GROUP BY 1` |
| Số lần thử sai liên tiếp trước khi bị chặn | Vô hạn | 10 lần / 15 phút theo tài khoản | Test tích hợp gửi 11 request sai, request thứ 11 nhận 429 |

> Số "trước" là minh họa để hình dung bài toán. Số "mục tiêu" chỉ được coi là đạt khi có số đo thật
> ở mục 5.1 kèm môi trường đo.

### 5.1 Số đã đo

**Môi trường:** MacBook (Darwin 25.6.0, arm64, 8 vCPU, 16 GB RAM); Docker 28.5.1; PostgreSQL 16.15; Redis 7.4.6; Node v20.19.6; k6 v1.4.2; `@node-rs/argon2` 2.2.2. Nguồn điện AC, nắp mở, không có khoảng máy ngủ; `load1` 5–9 (máy chạy chung với container `mysql_server`, `rabbitmq` của dự án khác). Quy mô: 10.000 user seed (MD5 không salt), từ điển tổng hợp 100.000 ứng viên, 200 tài khoản bench cho k6. File thô ở `bench/results/main/` (không commit).

**Tham số Argon2id chọn (`hash-params.json`):** quét 9 bộ ≥ tối thiểu OWASP cho web, chọn **m=65536 KiB (64 MiB), t=5, p=1** — trung vị **106,5 ms/hash** (103,2–110,3). Lý do: 64 MiB khớp "lựa chọn thứ hai" của RFC 9106; p=1 để dễ kiểm soát threadpool; t=5 để đạt ~100 ms trên máy này. Vài mốc khác (trung vị): m=19456/t=2 = 9,5 ms · m=47104/t=1 = 12,8 ms · m=65536/t=3 = 62,9 ms · m=98304/t=3 = 102,9 ms · m=131072/t=3 = 139,5 ms.

**Thử từ điển offline trên TOÀN BỘ bản dump (mọi cột: `password_md5` và `password_hash`) — đo lại 2026-10-09 sau khi sửa lỗi, file `bench/results/fix/crack-truoc.json` và `crack-sau.json`:**

| Chỉ số | Dump TRƯỚC migration | Dump SAU migration (đã xóa MD5) |
|---|---|---|
| Dòng còn cột MD5 | 10.000/10.000 | **0/10.000** |
| Tốc độ thử một ứng viên | ~1,19 triệu/giây qua MD5 (CPU 1 luồng; GPU hàng tỷ/giây — minh họa) | **9,1 verify/giây** qua Argon2id (110,2 ms/verify) |
| Tỷ lệ dump bẻ được bằng từ điển 100k | **85,2 %** (8.522) trong 0,08 s | **0 %** khi pepper giữ bí mật (thử đúng mật khẩu 50 TK → 0); nếu pepper cũng lộ: ngoại suy p50 22,5 phút/TK, p90 2,2 giờ/TK (đối chứng thật 268/269 TK mật khẩu top trong 400 verify) |

*(Nhãn: 85,2 % phụ thuộc giả định phân phối mật khẩu user lab — "minh họa"; tốc độ thử và số bẻ được — "đã đo"; thời gian cho tài khoản chưa thử thật — "ngoại suy" = verify đã đo × vị trí trong từ điển. Load 8,4–11,5 khi đo, cao hơn lượt chính, nên verify chậm hơn 99,2 ms của lượt chính.)*

> **Đính chính:** bản trước của mục này (`bench/results/main/crack.json`) báo "0 % khi không lộ pepper" nhưng chỉ thử cột `password_hash`; migration lúc đó giữ nguyên `password_md5`, nên dump thật vẫn lộ 85,2 %. Số đúng là bảng trên. Tham số Argon2id và số `/login` p95 không đổi (lượt `main`, không đo lại).

**Độ trễ `/login` dưới tải (`login.json`, 50 VU, 30 s, 3 vòng xoay thứ tự, UV_THREADPOOL_SIZE=4):**

| Chỉ số | `/truoc/login` (MD5) | `/sau/login` (Argon2id v2) |
|---|---|---|
| p95 | **8,4 ms** (8,3 / 8,5 / 8,4) | **1.610 ms** (1.588 / 1.766 / 1.610) |
| p50 | ~6,3 ms | ~1.500 ms |
| Thông lượng | ~7.500 req/s | ~32 req/s |
| CPU API mỗi vòng 30 s | ~32 giây-CPU (≈1 lõi) | ~123 giây-CPU (≈4 lõi = UV_THREADPOOL_SIZE) |

**Ảnh hưởng của `UV_THREADPOOL_SIZE` (bản sau, 50 VU, 20 s):** 2 → 17,3 req/s, p95 3.069 ms · 4 → 30 req/s, p95 2.424 ms · 8 → 39,7 req/s, p95 1.573 ms. Argon2 chạy trên threadpool libuv, nên thông lượng tăng gần tuyến tính theo số luồng và p95 giảm.

**Hành vi (Vitest, 14/14 xanh) + phép thử âm (6/6 drill đúng test kỳ vọng đỏ, `bench/results/fix/drills/summary.json`):** cùng mật khẩu → hai hash khác nhau (salt); hash cũ version 1 đăng nhập đúng → `hash_version` thành 2 và verify thẳng mật khẩu; sai 11 lần → 429; mật khẩu 100 ký tự không bị cắt (đổi ký tự thứ 100 thì verify thất bại); sau migration và sau nâng cấp không còn dòng nào mang `password_md5`.

**Đối chiếu mục tiêu:** verify 100–300 ms **đạt** (106,5 ms); "hai TK cùng mật khẩu → hash khác" **đạt**; "429 sau 10 lần sai" **đạt**; "lộ DB không còn là lộ mật khẩu" **đạt sau khi sửa** (toàn bộ dump: 85,2 % → 0 % khi giữ pepper; bản đầu không đạt vì còn cột MD5). Riêng "`/login` p95 ≤ trước + 300 ms với 50 VU đồng thời" **KHÔNG đạt** (1.610 ms so với 8,4 ms): băm CỐ Ý tốn ~106 ms và threadpool 4 luồng nên 50 request đồng thời xếp hàng — đúng đánh đổi ở mục 6. Chi phí mỗi hash (~106 ms) là thứ ta kiểm soát; p95 dưới đồng thời phải chỉnh bằng số pod / `UV_THREADPOOL_SIZE` (UV=8 kéo p95 từ ~2,4 s xuống ~1,6 s) hoặc giảm tham số.

**Hạn chế:** seed 10.000 (nhỏ hơn 1,8 triệu ở mục 1); từ điển tổng hợp (phân phối giả định); tấn công Argon2id là ngoại suy (chỉ bẻ thật 268 TK mật khẩu top); máy chạy chung container dự án khác (load 5–9), nên số độ trễ đọc cùng mức tranh CPU.

**Tác động nghiệp vụ mong đợi:** một lần lộ DB không còn đồng nghĩa với mất toàn bộ tài khoản — chi phí bẻ từng mật khẩu đủ cao để phần lớn người dùng kịp đổi; sàn tránh được đợt ép đổi mật khẩu diện rộng và các khiếu nại dây chuyền.

## 6. Đánh đổi và khi KHÔNG nên dùng

**Đánh đổi**
- Đăng nhập tốn CPU/RAM thật: 100 ms × số đăng nhập mỗi giây là tải phải tính vào quy mô pod; kẻ tấn công có thể dùng chính endpoint đăng nhập để gây DoS nếu không throttling.
- Binding native (`argon2`) phức tạp hóa Docker image và CI; phải có phương án bcrypt.
- Giai đoạn di trú có hai định dạng hash song song; tài khoản không hoạt động lâu không bao giờ được nâng cấp — cần chính sách (ép đặt lại sau N tháng).
- Pepper mang thêm một bí mật phải quản lý; mất pepper là mất khả năng xác minh toàn bộ.

**Không nên dùng khi**
- Hệ thống không lưu mật khẩu: đăng nhập hoàn toàn qua IdP/SSO (bài 07) hoặc passkey (bài 08).
- Giá trị cần lưu là bí mật ngẫu nhiên entropy cao do máy sinh (API key, refresh token, session id): SHA-256 đơn thuần là đủ và nhanh hơn nhiều (bài 04, bài 10).
- Cần kiểm tra "mật khẩu này có trong danh sách đã lộ không" cho hàng triệu bản ghi — đó là bài toán tra cứu theo hash tiền tố, không phải slow hash.

**Liên quan**
- [Bài 02 — Session Cookie vs JWT](../02-session-cookie-vs-jwt-spa-luu-token-o-dau/) — bước tiếp theo sau khi xác minh mật khẩu.
- [Bài 08 — MFA: TOTP & Passkeys](../08-mfa-totp-webauthn-passkey-tai-khoan-ke-toan-bi-chiem/) — khi mật khẩu đúng vẫn chưa đủ.
- [Scope 13 bài 03 — Rate Limiting & Throttling](../../13-backend-transporter/03-rate-limiting-mot-khach-api-goi-10k-req-s/) — giới hạn thử mật khẩu online.

## 7. Cơ sở tham khảo

- OWASP Cheat Sheet Series, "Password Storage Cheat Sheet" — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — thứ tự ưu tiên Argon2id, scrypt, bcrypt, PBKDF2; tham số tối thiểu khuyến nghị; pepper; cách nâng cấp hash cũ bằng bọc và băm lại khi đăng nhập.
- Biryukov, Dinu, Khovratovich, Josefsson, RFC 9106, *Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications*, 2021 — https://www.rfc-editor.org/rfc/rfc9106 — đặc tả Argon2id và khuyến nghị tham số theo tài nguyên sẵn có.
- `@node-rs/argon2` (napi-rs), thư viện Argon2id cho Node.js — https://www.npmjs.com/package/@node-rs/argon2 — API `hash`/`verify`/`parseOptions`, định dạng PHC string, tham số `secret` (pepper). Lab chọn gói này thay `argon2` (node-argon2) vì prebuild `darwin-arm64` của node-argon2 0.45.1 bị lỗi trên máy đích (xem mục 3.4, nhật ký 19/01).
- OWASP Cheat Sheet Series, "Authentication Cheat Sheet" và "Credential Stuffing Prevention Cheat Sheet" — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html , https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html — lỗi chung không phân biệt tài khoản, chống dò tài khoản, và giới hạn thử online (bộ đếm sai).
- NestJS docs, "Authentication" — https://docs.nestjs.com/security/authentication — cấu trúc module auth dùng cho phần thực hành.

## 8. Kế hoạch thực hành

- [x] Bước 1: dựng Postgres + Redis (`docker compose up -d --wait`); seed 10.000 user MD5 không salt (`scripts/seed.ts`, MD5 ở `src/shared/md5.ts` dùng bởi `src/truoc/`); script "kẻ tấn công" (`bench/crack-dictionary.ts`) thử từ điển TỔNG HỢP 100k (`bench/lib/dictionary.ts`, sinh bằng code, không tải list lộ) → **85,2 %** bẻ được cột MD5.
- [x] Bước 2: đo "trước": tốc độ thử ~1,21 triệu ứng viên/giây, p95 `/truoc/login` 8,4 ms, 8.522/10.000 TK bẻ được (mục 5.1).
- [x] Bước 3: `PasswordHasher` Argon2id (`src/sau/`, tham số chọn bằng `bench/hash-params.bench.ts` → m=65536,t=5,p=1), PHC string, `needsRehash`, migration bọc `argon2id(md5)` **và xóa `password_md5`** trong cùng câu UPDATE (`src/sau/wrap-legacy-migration.ts`, gọi từ `scripts/migrate-wrap.ts`), nâng cấp cơ hội khi đăng nhập (`hash_version`, cũng xóa MD5), bộ đếm sai Redis (429 sau 10 lần).
- [x] Bước 4: đo "sau" cùng kịch bản + chạy lại tấn công trên **toàn bộ dump sau migration** (mọi cột): 0 % bẻ được (cột MD5 đã xóa; cột Argon2id cần pepper); p95 `/sau/login` 1.610 ms (mục 5.1).
- [x] Bước 5: test Vitest (14/14) + phép thử âm (`bench/negative-drills.ts`, 6/6): cùng mật khẩu cho hash khác; hash cũ đăng nhập đúng thì `hash_version` thành 2; sai 11 lần thì 429; mật khẩu 100 ký tự không bị cắt; sau migration/nâng cấp không còn dòng nào mang `password_md5`.

**Cấu trúc code (thật)**
```text
src/
  truoc/login-md5.service.ts    # tái hiện cách lưu cũ: so MD5(pw) với cột
  truoc/truoc.controller.ts     # POST /truoc/login
  sau/password-hasher.ts        # [PATTERN] Argon2id + PHC string + needsRehash (tự parse)
  sau/legacy-hash-adapter.ts    # [PATTERN] verify argon2id(md5) cho hash_version=1
  sau/login.service.ts          # [PATTERN] verify theo version, nâng cấp cơ hội, bộ đếm sai
  sau/failed-login-counter.ts   # [PATTERN] bộ đếm sai Redis → 429
  sau/wrap-legacy-migration.ts  # [PATTERN] bọc argon2id(md5) + xóa password_md5 trong cùng UPDATE
  sau/sau.controller.ts         # POST /sau/login
  shared/db.ts  shared/redis.ts  shared/md5.ts  shared/shared.module.ts
scripts/
  seed.ts                       # seed 10.000 user MD5 (pnpm db:seed)
  migrate-wrap.ts               # gọi wrapLegacyHashes cho toàn bảng (pnpm migrate:wrap)
bench/
  lib/dictionary.ts             # từ điển tổng hợp 100k, deterministic (không tải list lộ)
  hash-params.bench.ts  crack-dictionary.ts  run-login.ts  login.k6.js  negative-drills.ts
test/
  password-hasher.test.ts  login-upgrade.test.ts  rate-limit.test.ts  migration.test.ts
db/schema.sql  docker-compose.yml  .env.example
```

**Cách chạy** *(đã chạy từ đầu trên máy sạch)*
```bash
docker compose up -d --wait            # PostgreSQL 55432 + Redis 56379
pnpm install
cp .env.example .env                   # đặt PASSWORD_PEPPER ngẫu nhiên khi chạy thật
pnpm test                              # 14 test (cần db:up; KHÔNG cần seed)
# Tái hiện số đo (đặt PASSWORD_PEPPER, ARGON2_* như .env; RUN=<tên> ghi vào bench/results/<tên>).
# Sửa db/schema.sql thì phải `docker compose down -v` rồi dựng lại: schema chỉ nạp lúc tạo volume.
RUN=main pnpm bench:params             # chọn tham số Argon2id trên máy này
SEED_COUNT=10000 pnpm db:seed          # 10.000 user MD5 không salt
RUN=fix OUT_NAME=crack-truoc.json pnpm bench:crack   # tấn công cả dump TRƯỚC migration (còn cột MD5)
pnpm migrate:wrap                      # bọc argon2id(md5) + xóa password_md5 (~5 phút ở tham số thật)
RUN=fix OUT_NAME=crack-sau.json pnpm bench:crack     # tấn công cả dump SAU migration (mọi cột)
RUN=main pnpm bench:login              # p95 /login trước/sau + quét UV_THREADPOOL_SIZE
RUN=fix pnpm bench:drills              # phép thử âm (6 drill)
```

## Bài học sau khi làm

- **Salt đánh bại rainbow table, slow-hash đánh bại brute-force, pepper đánh bại chính việc lộ DB.** Đo thật trên toàn bộ dump: trước migration 85,2 % bẻ được trong 0,08 giây; sau migration (đã xóa MD5) chỉ còn Argon2id, ~9–10 verify/giây — và nếu pepper không lộ cùng DB thì 0 %. Ba lớp bảo vệ bù cho nhau, không thay nhau.
- **Chi phí băm là con dao hai lưỡi, phải đo trên máy đích.** Tham số cho ~106 ms/hash (RFC 9106 §4) khiến `/login` p95 ở 50 VU đồng thời lên ~1,6 giây vì threadpool libuv chỉ 4 luồng — chính endpoint đăng nhập thành điểm DoS nếu không giới hạn đồng thời. `UV_THREADPOOL_SIZE` 2→4→8 kéo thông lượng 17→30→40 req/s: số luồng và số pod phải tính vào quy mô, không chỉ chọn tham số cho đẹp.
- **Nâng cấp hash không cần mật khẩu gốc — nhưng phải XÓA hash cũ cùng lúc.** Migration bọc `argon2id(md5)` đóng lỗ hổng ngay trong đêm; `hash_version` + băm lại khi đăng nhập dần thay bằng `argon2id(mật khẩu thật)`. Một cột `hash_version` cho cả cách đóng lỗ tức thì lẫn cách đo tiến độ di trú bằng một câu SQL. **Bài học đắt nhất:** bản đầu tiên bọc hash mới mà GIỮ nguyên cột `password_md5`, nên dump sau migration vẫn lộ 85 % mật khẩu — "đã áp pattern" nhưng chưa đóng lỗ. Lỗi này **lọt qua 12 test và 4 phép thử âm** (chúng chỉ kiểm cột `password_hash`) và chỉ bị phát hiện khi người điều phối **dump cả bảng lúc kiểm đầu cuối**. Sửa: `password_md5 = NULL` ngay trong câu `UPDATE` của migration và trong `rehash`; thêm test bất biến "không còn dòng nào mang `password_md5` sau migration/nâng cấp" + 2 phép thử âm; và script tấn công nay thử MỌI cột của dump (không chỉ cột hash mới).
- **Lỗi gặp thật:** (1) `argon2` (node-argon2 0.45.1) có prebuild `darwin-arm64` nhưng là binary Linux → Node thoát mã 139; chuyển sang `@node-rs/argon2` (napi, gói nền tảng riêng). (2) NestJS chạy bằng `tsx` không phát `design:paramtypes` nên phải `@Inject` tường minh — test Vitest vẫn xanh nên lỗi chỉ lộ khi chạy app thật qua `bench/run-login.ts` (nhật ký 08/01 điểm 1). (3) ioredis `enableOfflineQueue:false` khiến test phải chờ `ready` trước `flushdb`.
- **Hạn chế số đo:** từ điển là tổng hợp (tỷ lệ bẻ được phụ thuộc giả định phân phối — minh họa); tấn công Argon2id là ngoại suy từ tốc độ verify đã đo; seed 10.000 (< 1,8 triệu ở bối cảnh); máy chạy chung container dự án khác (load 5–9).
