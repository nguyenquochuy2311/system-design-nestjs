#!/usr/bin/env node
/**
 * Trích mọi khối ```mermaid trong repo, sinh trang .cache/mermaid-check.html dùng mermaid.min.js
 * (tải một lần về .cache) để parse từng khối và liệt kê lỗi cú pháp, rồi phục vụ thư mục .cache qua HTTP.
 * Chạy: node scripts/xem-mermaid.mjs [port]   → mở http://localhost:<port>/mermaid-check.html
 * Trang đặt kết quả vào window.__RESULT__ = { total, errors: [{file, index, error}] }.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, '.cache');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);

const blocks = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.md')) {
      const md = readFileSync(p, 'utf8');
      let i = 0;
      for (const m of md.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)) {
        blocks.push({ file: relative(ROOT, p), index: i++, code: m[1] });
      }
    }
  }
}
walk(ROOT);

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Kiểm tra Mermaid</title>
<style>body{font-family:system-ui;margin:24px;background:#fff;color:#111}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px}</style></head>
<body><h1 id="h">Đang kiểm tra ${blocks.length} sơ đồ…</h1><pre id="out"></pre>
<script src="mermaid.min.js"></script>
<script type="module">
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
const blocks = ${JSON.stringify(blocks)};
const errors = [];
for (const b of blocks) {
  try { await mermaid.parse(b.code); }
  catch (e) { errors.push({ file: b.file, index: b.index, error: String(e && e.message || e).split('\\n').slice(0, 3).join(' | ') }); }
}
window.__RESULT__ = { total: blocks.length, errors };
document.getElementById('h').textContent = 'Xong: ' + blocks.length + ' sơ đồ, ' + errors.length + ' lỗi cú pháp';
document.getElementById('out').textContent = errors.length ? JSON.stringify(errors, null, 2) : 'Tất cả sơ đồ parse thành công.';
</script></body></html>`;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const MERMAID_FILE = join(OUT_DIR, 'mermaid.min.js');
if (!existsSync(MERMAID_FILE)) {
  const url = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
  console.log(`Tải ${url} …`);
  const res = await fetch(url);
  if (!res.ok) { console.error(`Không tải được mermaid.min.js: HTTP ${res.status}`); process.exit(1); }
  writeFileSync(MERMAID_FILE, Buffer.from(await res.arrayBuffer()));
}
writeFileSync(join(OUT_DIR, 'mermaid-check.html'), html);
console.log(`${blocks.length} khối mermaid → .cache/mermaid-check.html`);

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript' };
createServer((req, res) => {
  const file = join(OUT_DIR, decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'mermaid-check.html');
  if (!file.startsWith(OUT_DIR) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`http://localhost:${PORT}/mermaid-check.html`));
