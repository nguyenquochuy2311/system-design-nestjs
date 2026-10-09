// Nhận diện và che dữ liệu cá nhân trong log: số điện thoại di động Việt Nam và số thẻ (dạng Luhn).
// Dùng ở hai nơi: serializer của `err` (chuỗi tự do — redact theo đường dẫn không với tới) và bộ đếm/test quét log thật.

// Ranh giới là "không phải chữ/số/_" (không chỉ "không phải số"): trace_id, span_id là hex 32/16 ký tự và thường chứa
// chuỗi chữ số liền nhau — chỉ dùng (?<!\d) thì một phần trace_id bị nhận nhầm là số điện thoại.

/** Số di động VN: 0 hoặc +84/84, rồi đầu 3/5/7/8/9 và 8 chữ số; cho phép dấu cách/chấm/gạch giữa các cụm. */
export const VN_PHONE_RE = /(?<![\w+])(?:\+?84|0)[ .-]?[35789](?:[ .-]?\d){8}(?!\w)/g;

/** Chuỗi 13–19 chữ số (có thể cách bằng dấu cách/gạch) — ứng viên số thẻ; chỉ tính là thẻ khi qua kiểm tra Luhn. */
const CARD_CANDIDATE_RE = /(?<!\w)\d(?:[ -]?\d){12,18}(?!\w)/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export interface PiiHit {
  kind: 'phone' | 'card';
  value: string;
}

/** Mọi chỗ trong `text` khớp số điện thoại VN hoặc số thẻ hợp lệ Luhn. */
export function findPii(text: string): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const m of text.matchAll(VN_PHONE_RE)) hits.push({ kind: 'phone', value: m[0] });
  for (const m of text.matchAll(CARD_CANDIDATE_RE)) {
    if (luhnValid(m[0].replace(/[ -]/g, ''))) hits.push({ kind: 'card', value: m[0] });
  }
  return hits;
}

/** Che một số điện thoại: chỉ giữ 3 số cuối (đủ để chăm sóc khách hàng đối chiếu khi khách đọc số). */
export const maskPhone = (v: string) => `***${v.replace(/\D/g, '').slice(-3)}`;
/** Che số thẻ: chỉ giữ 4 số cuối (theo thông lệ in trên hóa đơn). */
export const maskCard = (v: string) => `****${v.replace(/\D/g, '').slice(-4)}`;

/** Thay mọi số điện thoại/số thẻ trong một chuỗi tự do bằng dạng đã che. */
export function scrubText(text: string): string {
  return text
    .replace(CARD_CANDIDATE_RE, (m) => (luhnValid(m.replace(/[ -]/g, '')) ? maskCard(m) : m))
    .replace(VN_PHONE_RE, (m) => maskPhone(m));
}
