import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { RELEASES, isReleaseId, type Site } from './releases.ts';

// Build một bản phát hành cho một site: SITE=truoc|sau, RELEASE=41..44, OUT_DIR=<thư mục ra>.
// Hai site dùng chung mã nguồn; khác nhau ở cách đặt tên file (ở đây), header (nginx/site-*.conf), cách deploy
// (scripts/deploy.ts) và hai module chỉ bản sau có (src/sau/).
const root = fileURLToPath(new URL('.', import.meta.url));
const site: Site = process.env.SITE === 'truoc' ? 'truoc' : 'sau';
const release = process.env.RELEASE ?? '41';
if (!isReleaseId(release)) throw new Error(`RELEASE không có trong web/releases.ts: ${release}`);
const r = RELEASES[release];

/** Bản sau: thêm hai file vào cửa có URL cố định vào bản build: version.json và loader widget.js cho đối tác. */
function entryFiles(): Plugin {
  return {
    name: 'lab-entry-files',
    apply: 'build',
    generateBundle(_options, bundle) {
      const widget = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry && f.name === 'widget');
      if (!widget) throw new Error('không thấy entry widget');
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version: release })}\n` });
      // [PATTERN] Loader URL cố định (no-cache): đối tác nhúng /widget.js, loader trỏ tới file có hash của bản hiện tại.
      const loader = `(function(){var s=document.createElement('script');s.type='module';s.src='/${widget.fileName}';document.head.appendChild(s);})();\n`;
      this.emitFile({ type: 'asset', fileName: 'widget.js', source: loader });
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  logLevel: 'warn',
  plugins: [react(), ...(site === 'sau' ? [entryFiles()] : [])],
  define: {
    __SITE__: JSON.stringify(site),
    __RELEASE__: JSON.stringify(release),
    __CONTRACT__: String(r.contract),
    __REPORTS_LAYOUT__: JSON.stringify(r.reportsLayout),
    // Production hỏi version.json mỗi 10 phút (và mỗi lần đổi màn hình, khi tab hiện lại).
    __VERSION_POLL_MS__: String(Number(process.env.VERSION_POLL_MS ?? 600_000)),
  },
  build: {
    outDir: process.env.OUT_DIR ?? `${root}/dist`,
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      input: { index: `${root}/index.html`, widget: `${root}/widget/widget.ts` },
      output: {
        // React tách riêng thành chunk vendor: đổi mã ứng dụng không đổi chunk này.
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] },
        ...(site === 'sau'
          ? {
              // [PATTERN] Tên file theo hash nội dung (mặc định của Vite, ghi tường minh): nội dung đổi thì URL đổi.
              entryFileNames: 'assets/[name]-[hash].js',
              chunkFileNames: 'assets/[name]-[hash].js',
              assetFileNames: 'assets/[name]-[hash][extname]',
            }
          : {
              // Hiện trạng: tắt hash để đối tác nhúng URL cố định — mọi bản dùng chung app.js, vendor.js, reports.js...
              entryFileNames: (chunk) => (chunk.name === 'index' ? 'app.js' : '[name].js'),
              chunkFileNames: '[name].js',
              assetFileNames: (asset) => (asset.names.some((n) => n.endsWith('.css')) ? 'app.css' : '[name][extname]'),
            }),
      },
    },
  },
});
