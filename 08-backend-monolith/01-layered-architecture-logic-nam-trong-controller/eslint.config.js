import tseslint from 'typescript-eslint';

// Chỉ bật hai luật đo "độ phình" của hàm; `pnpm lint` chạy trên src/sau và src/shared như một cổng CI.
// Bản "trước" (src/truoc) cố ý vi phạm: test/architecture/function-size.test.ts đếm vi phạm của nó.
export default tseslint.config(
  { ignores: ['node_modules/**', 'coverage/**', 'bench/results/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // [PATTERN] Giữ controller, job và service mỏng bằng công cụ thay vì bằng lời dặn.
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
    },
  },
);
