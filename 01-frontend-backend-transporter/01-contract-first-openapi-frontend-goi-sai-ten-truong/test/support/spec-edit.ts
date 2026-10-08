/** Sửa spec trong bản sao ở `.tmp/` (bị .gitignore), không bao giờ sửa `openapi.yaml` thật trong test. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { LAB_DIR, SPEC } from '../../packages/api-contract/ci/steps.js';

type Json = Record<string, any>; // spec là JSON tùy ý

export function writeSpecVariant(name: string, edit: (spec: Json) => void): string {
  const spec = parse(readFileSync(join(LAB_DIR, SPEC), 'utf8')) as Json;
  edit(spec);
  mkdirSync(join(LAB_DIR, '.tmp'), { recursive: true });
  const rel = `.tmp/spec-${name}-${process.pid}.yaml`;
  writeFileSync(join(LAB_DIR, rel), stringify(spec));
  return rel;
}
