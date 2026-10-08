/**
 * Từ điển mật khẩu TỔNG HỢP, sinh hoàn toàn bằng code, DETERMINISTIC (hạt cố định).
 *
 * KHÔNG tải danh sách mật khẩu bị lộ từ Internet (rockyou, SecLists...). Thay vào đó mô phỏng các mẫu phổ
 * biến có thật: từ thường + năm, tên + số, mẫu bàn phím (123456, qwerty), đổi chữ thành số (leetspeak).
 * Vì là từ điển tổng hợp, "tỷ lệ bẻ được" phụ thuộc GIẢ ĐỊNH phân phối mật khẩu của người dùng lab
 * (nhãn "minh họa" cho giả định); còn tốc độ thử mỗi ứng viên và số bẻ được trên dữ liệu lab là "đã đo".
 *
 * Thứ tự trong từ điển đặt ứng viên phổ biến lên trước, nên vị trí trong từ điển phản ánh độ phổ biến —
 * dùng để ước tính "kẻ tấn công phải tìm sâu bao nhiêu" cho bản Argon2id.
 */

/** PRNG đơn giản, deterministic (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mẫu bàn phím và mật khẩu "kinh điển" — đặt lên đầu vì phổ biến nhất.
const KEYBOARD = [
  '123456', '123456789', '12345678', '1234567', '12345', '111111', '000000', '123123', '654321',
  'password', 'qwerty', 'qwertyuiop', 'abc123', '1q2w3e4r', '1qaz2wsx', 'asdfgh', 'zxcvbnm',
  'iloveyou', 'admin', 'welcome', 'letmein', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'passw0rd', 'p@ssw0rd', 'master', 'superman', 'batman', 'trustno1', 'whatever', 'michael',
];

// Từ thường (Anh + romanized Việt) và tên — nguồn để ghép năm/số.
const WORDS = [
  'password', 'matkhau', 'vietnam', 'hanoi', 'saigon', 'danang', 'haiphong', 'cantho', 'hue',
  'company', 'congty', 'admin', 'user', 'login', 'welcome', 'summer', 'winter', 'spring', 'autumn',
  'football', 'barca', 'arsenal', 'chelsea', 'liverpool', 'manutd', 'ronaldo', 'messi',
  'computer', 'internet', 'shopping', 'banking', 'money', 'shopee', 'tiki', 'lazada',
  'love', 'family', 'happy', 'freedom', 'dragon', 'tiger', 'phoenix', 'lucky', 'star', 'moon', 'sun',
];
const NAMES = [
  'hung', 'minh', 'linh', 'huong', 'thao', 'nam', 'trang', 'tuan', 'anh', 'phuong', 'quang', 'duc',
  'hieu', 'thanh', 'hoa', 'lan', 'mai', 'ngoc', 'binh', 'cuong', 'dung', 'giang', 'khanh', 'long',
  'nguyen', 'tran', 'le', 'pham', 'hoang', 'vu', 'dang', 'bui', 'do', 'ho', 'ngo', 'duong',
];
const YEARS = Array.from({ length: 2026 - 1975 + 1 }, (_, i) => 1975 + i);
const SPECIAL = ['', '!', '@', '123', '@123', '!@#', '2024', '@2024'];

function leet(w: string): string {
  return w.replace(/a/g, '@').replace(/o/g, '0').replace(/e/g, '3').replace(/i/g, '1').replace(/s/g, '$');
}
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Sinh từ điển `size` ứng viên (mặc định 100.000), thứ tự deterministic, phổ biến trước.
 * Trả về mảng đã khử trùng lặp, cắt đúng `size`.
 */
export function generateDictionary(size = 100_000): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    if (s.length >= 4 && s.length <= 64 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };

  for (const k of KEYBOARD) push(k);
  // Tên/từ + hậu tố đặc biệt (phổ biến hơn, đặt trước).
  for (const w of [...NAMES, ...WORDS]) for (const s of SPECIAL) push(w + s);
  for (const w of [...NAMES, ...WORDS]) for (const s of SPECIAL) push(cap(w) + s);
  // Tên/từ + năm (ví dụ sinh nhật, năm hiện tại).
  for (const w of [...NAMES, ...WORDS]) for (const y of YEARS) push(w + y);
  for (const w of [...NAMES, ...WORDS]) for (const y of YEARS) push(cap(w) + y);
  for (const w of [...NAMES, ...WORDS]) for (const y of YEARS) push(cap(w) + y + '!');
  for (const w of [...NAMES, ...WORDS]) for (const y of YEARS) push(w + '@' + y);
  // Đổi chữ thành số (leetspeak).
  for (const w of [...WORDS, ...NAMES]) push(leet(w));
  for (const w of [...WORDS, ...NAMES]) for (const y of YEARS) push(leet(w) + y);
  // Tên/từ + số 0..999 để lấp đầy phần đuôi.
  for (let n = 0; n <= 999 && out.length < size; n++)
    for (const w of [...NAMES, ...WORDS]) {
      push(w + n);
      if (out.length >= size) break;
    }

  return out.slice(0, size);
}

export interface SeedUser {
  email: string;
  password: string;
  /** Mật khẩu này có nằm trong từ điển tổng hợp không (để minh họa tỷ lệ "bẻ được" theo giả định phân phối). */
  inDict: boolean;
}

/**
 * Gán mật khẩu cho `count` user, DETERMINISTIC theo `seed`. Giả định phân phối (minh họa):
 *   - `outsideRatio` tỷ lệ người dùng đặt mật khẩu MẠNH ngẫu nhiên (ngoài từ điển);
 *   - còn lại chọn từ từ điển, thiên về phần đầu (phổ biến) bằng số mũ > 1.
 * Mật khẩu là dữ liệu tổng hợp, sinh lại được từ hạt; KHÔNG ghi ra file.
 */
export function assignSeedPasswords(
  count: number,
  dict: string[],
  seed = 1_900_19_01,
  outsideRatio = 0.15,
): SeedUser[] {
  const rnd = mulberry32(seed);
  const users: SeedUser[] = [];
  for (let i = 0; i < count; i++) {
    const email = `user${String(i).padStart(5, '0')}@lab.example`;
    if (rnd() < outsideRatio) {
      // Mật khẩu mạnh ngẫu nhiên 16 ký tự a-z0-9 — gần như chắc chắn ngoài từ điển.
      let p = '';
      for (let j = 0; j < 16; j++) p += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)];
      users.push({ email, password: `Zx-${p}`, inDict: false });
    } else {
      // Thiên về đầu từ điển: r^3 dồn chỉ số về phía trước (mật khẩu phổ biến).
      const idx = Math.min(dict.length - 1, Math.floor(dict.length * Math.pow(rnd(), 3)));
      users.push({ email, password: dict[idx]!, inDict: true });
    }
  }
  return users;
}
