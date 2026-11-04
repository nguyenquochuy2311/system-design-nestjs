import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXTS = ['catalog', 'inventory', 'ordering', 'payment'];

async function lintAs(file: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'fatal');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('Ranh giới code giữa các context', () => {
  it('ESLint chặn Ordering import kiểu từ Catalog', async () => {
    const code = "import type { ChangedProduct } from '../catalog/published-event';\nexport type P = ChangedProduct;\n";
    expect(await lintAs('apps/ordering/price.ts', code)).toEqual(['no-restricted-imports']);
  });

  it('ESLint chặn mọi cặp context, kể cả re-export', async () => {
    for (const context of CONTEXTS) {
      for (const other of CONTEXTS.filter((name) => name !== context)) {
        const code = `export * from '../${other}/anything';\n`;
        expect(await lintAs(`apps/${context}/x.ts`, code)).toEqual(['no-restricted-imports']);
      }
    }
  });

  it('ESLint cho phép import libs/platform và file trong cùng context', async () => {
    const code = "import { logEvent } from '../../libs/platform/log';\nimport { priceLines } from './pricing';\nexport { logEvent, priceLines };\n";
    expect(await lintAs('apps/ordering/x.ts', code)).toEqual([]);
  });

  it('libs/platform không phụ thuộc vào context nào', async () => {
    expect(await lintAs('libs/platform/x.ts', "export * from '../../apps/ordering/pricing';\n")).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('mã nguồn hiện tại không có lỗi ranh giới', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const results = await eslint.lintFiles(['apps', 'libs']);
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });

  // Bộ đếm độc lập với ESLint: nếu cấu hình luật bị hỏng thì test này vẫn thấy import chéo.
  it('đếm import chéo bằng cách phân giải đường dẫn thật: 0', () => {
    const crossImports: string[] = [];
    for (const context of CONTEXTS) {
      for (const file of sourceFiles(join(ROOT, 'apps', context))) {
        const specifiers = readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g);
        for (const [, specifier] of specifiers) {
          const target = relative(join(ROOT, 'apps'), resolve(dirname(file), specifier as string));
          const owner = target.split('/')[0];
          if (!target.startsWith('..') && owner !== context) {
            crossImports.push(`${relative(ROOT, file)} → ${specifier}`);
          }
        }
      }
    }
    expect(crossImports).toEqual([]);
  });
});
