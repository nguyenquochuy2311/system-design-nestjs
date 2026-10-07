import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Cùng eslint.config.js với `pnpm lint`: max-lines-per-function 30, complexity 10.
async function problems(paths: string[]) {
  const results = await new ESLint().lintFiles(paths);
  return results.flatMap((r) => r.messages.map((m) => ({ file: r.filePath.split('/src/')[1], rule: m.ruleId, message: m.message })));
}

describe('độ dài và độ phức tạp hàm (ESLint)', () => {
  it('sau và shared: không hàm nào quá 30 dòng hay độ phức tạp quá 10', async () => {
    expect(await problems(['src/sau', 'src/shared'])).toEqual([]);
  });

  it('trước: phương thức create của controller vượt cả hai ngưỡng', async () => {
    const found = await problems(['src/truoc']);
    const create = found.filter((p) => p.file === 'truoc/orders.controller.ts' && p.message.includes("method 'create'"));
    expect(create.map((p) => p.rule).sort()).toEqual(['complexity', 'max-lines-per-function']);
  });
});
