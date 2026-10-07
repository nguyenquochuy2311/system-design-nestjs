// [PATTERN] Luật hướng phụ thuộc giữa các lớp, chạy trong CI: `pnpm depcruise` thoát mã khác 0 khi vi phạm.
// Luật viết theo đường dẫn chung (presentation/, application/, domain/, infrastructure/, *.controller.ts,
// *.job.ts) nên áp được cho cả bản "trước", bản "sau" và fixture của phép thử âm trong test/.

// Đường vào: controller, job (bản "trước" để phẳng nên nhận theo hậu tố tên file).
const ENTRY_POINT = '(^|/)(presentation/|[^/]+[.](controller|job)[.]ts$)';
// Truy cập dữ liệu: lớp infrastructure, file tạo kết nối Kysely dùng chung, và chính thư viện kysely/pg.
const DATA_ACCESS = ['(^|/)infrastructure/', '(^|/)src/shared/db[.]ts$', '(^|/)node_modules/(kysely|pg)/'];

module.exports = {
  forbidden: [
    {
      name: 'entry-point-not-to-data-access',
      severity: 'error',
      comment: 'Controller và job không gọi thẳng DB hay repository Kysely; đi qua service của lớp application.',
      from: { path: ENTRY_POINT },
      to: { path: DATA_ACCESS },
    },
    {
      name: 'entry-point-not-to-entry-point',
      severity: 'error',
      comment: 'Job không import từ controller (và ngược lại): phần dùng chung phải nằm ở lớp dưới.',
      from: { path: '[.](controller|job)[.]ts$' },
      to: { path: '[.](controller|job)[.]ts$' },
    },
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment: 'Domain là hàm và kiểu thuần: không biết NestJS, Kysely hay các lớp khác.',
      from: { path: '(^|/)domain/' },
      to: { path: ['(^|/)(application|infrastructure|presentation)/', '(^|/)node_modules/@nestjs/', ...DATA_ACCESS] },
    },
    {
      name: 'application-not-to-infrastructure',
      severity: 'error',
      comment: 'Service chỉ biết interface repository; hiện thực Kysely được ghép ở module NestJS.',
      from: { path: '(^|/)application/' },
      to: { path: ['(^|/)presentation/', ...DATA_ACCESS] },
    },
    {
      name: 'infrastructure-not-to-presentation',
      severity: 'error',
      comment: 'Lớp dưới không biết lớp trên.',
      from: { path: '(^|/)infrastructure/' },
      to: { path: '(^|/)presentation/' },
    },
    {
      name: 'sau-not-to-truoc',
      severity: 'error',
      comment: 'Bản "sau" không dựa vào code cũ.',
      from: { path: '^src/sau/' },
      to: { path: '^src/truoc/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
  },
};
