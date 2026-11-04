import tseslint from 'typescript-eslint';

const CONTEXTS = ['catalog', 'inventory', 'ordering', 'payment'];

const forbid = (names, message) => ({
  patterns: [{ group: names.flatMap((name) => [`**/${name}`, `**/${name}/**`]), message }],
});

// [PATTERN] Ranh giới context được công cụ giữ, không dựa vào lời dặn: một context không import code của context khác,
// kể cả `import type`, vì dùng chung kiểu "sản phẩm" là quay lại một mô hình cho mọi nơi. Chỉ dùng chung libs/platform.
const contextBoundaries = CONTEXTS.map((context) => ({
  files: [`apps/${context}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      forbid(
        [...CONTEXTS.filter((other) => other !== context), 'truoc'],
        `Context ${context} không được import code của context khác; giao tiếp qua API hoặc sự kiện (docs/context-map.md).`,
      ),
    ],
  },
}));

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'bench/results/**'] },
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  ...contextBoundaries,
  {
    files: ['apps/truoc/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', forbid(CONTEXTS, 'Bản "trước" không dùng code của bản "sau".')] },
  },
  {
    files: ['libs/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        forbid([...CONTEXTS, 'truoc', 'apps'], 'libs/platform chỉ chứa hạ tầng, không phụ thuộc vào context nào.'),
      ],
    },
  },
);
