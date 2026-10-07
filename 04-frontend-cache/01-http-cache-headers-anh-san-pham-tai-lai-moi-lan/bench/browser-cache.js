// Cache riêng (private cache) của một khách, rút gọn từ RFC 9111, để k6 — vốn không có HTTP cache — gửi đúng những request
// mà trình duyệt gửi ở lượt xem lặp lại. JS thuần (ES module) để k6 nạp được. Đối chiếu với Chrome thật bằng
// bench/browser-bytes.ts (kiểm tra "emulation-check").
// Phạm vi có chủ đích hẹp, đủ cho các header của lab:
//  - không lưu khi có no-store; private được lưu (đây là cache riêng); s-maxage bị bỏ qua (chỉ dành cho cache dùng chung);
//  - thời gian fresh = max-age; no-cache hoặc không có max-age thì coi là hết hạn ngay (KHÔNG có heuristic freshness);
//  - hết hạn mà có ETag / Last-Modified thì hỏi lại bằng If-None-Match / If-Modified-Since, nhận 304 thì làm mới bản lưu;
//  - bỏ qua Vary vì mỗi khách luôn gửi cùng header cho cùng URL.

export function parseCacheControl(value) {
  const out = {};
  for (const part of String(value || '').split(',')) {
    const [k, v] = part.trim().split('=');
    if (k) out[k.toLowerCase()] = v === undefined ? true : v.replace(/^"|"$/g, '');
  }
  return out;
}

export function header(headers, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers || {})) if (k.toLowerCase() === lower) return headers[k];
  return undefined;
}

export class BrowserCache {
  constructor() {
    this.entries = {};
  }

  /** Trước khi gửi: 'use' (dùng bản lưu, không request), 'revalidate' (kèm header điều kiện) hoặc 'fetch'. */
  lookup(url, nowMs) {
    const e = this.entries[url];
    if (!e) return { action: 'fetch' };
    if (nowMs - e.storedAt < e.freshMs) return { action: 'use', body: e.body };
    const conditional = {};
    if (e.etag) conditional['If-None-Match'] = e.etag;
    if (e.lastModified) conditional['If-Modified-Since'] = e.lastModified;
    if (Object.keys(conditional).length === 0) return { action: 'fetch' };
    return { action: 'revalidate', headers: conditional, body: e.body };
  }

  /** Sau khi nhận response từ mạng. Trả về body dùng được (body mới, hoặc body đã lưu nếu 304). */
  update(url, status, headers, body, nowMs) {
    const cc = parseCacheControl(header(headers, 'Cache-Control'));
    if (status === 304) {
      const e = this.entries[url];
      if (!e) return body;
      if (header(headers, 'Cache-Control')) e.freshMs = freshness(cc);
      if (header(headers, 'ETag')) e.etag = header(headers, 'ETag');
      e.storedAt = nowMs;
      return e.body;
    }
    if (status !== 200 || cc['no-store']) {
      delete this.entries[url];
      return body;
    }
    this.entries[url] = {
      storedAt: nowMs,
      freshMs: freshness(cc),
      etag: header(headers, 'ETag'),
      lastModified: header(headers, 'Last-Modified'),
      body,
    };
    return body;
  }
}

function freshness(cc) {
  if (cc['no-cache']) return 0;
  const maxAge = Number(cc['max-age']);
  return Number.isFinite(maxAge) && maxAge > 0 ? maxAge * 1000 : 0;
}

/** Đường dẫn file /_next/static trong HTML (script, stylesheet, preload). Bỏ <script noModule> (polyfill cho trình
 *  duyệt cũ): Chrome không tải thẻ này, đã đối chiếu bằng emulation-check. */
export function staticAssetsIn(html) {
  const seen = {};
  const out = [];
  const tags = String(html || '').match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (/\bnomodule\b/i.test(tag)) continue;
    const m = /(?:src|href)="(\/_next\/static\/[^"]+)"/.exec(tag);
    if (m && !seen[m[1]]) {
      seen[m[1]] = true;
      out.push(m[1]);
    }
  }
  return out;
}
