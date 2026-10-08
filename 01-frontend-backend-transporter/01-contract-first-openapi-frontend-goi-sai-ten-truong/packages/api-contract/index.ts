/**
 * Package `api-contract`: spec OpenAPI 3.1 + bộ kiểm tra JSON Schema nạp thẳng từ spec.
 * Backend dùng để kiểm request lúc chạy; test hợp đồng dùng để kiểm response. Không chép schema sang chỗ khác:
 * Ajv đọc đúng các nút `schema` trong `openapi.yaml` qua JSON Pointer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';

export type { components, operations, paths } from './generated/schema.js';

export const SPEC_PATH = fileURLToPath(new URL('./openapi.yaml', import.meta.url));
const SPEC_ID = 'https://contract.lab/openapi.yaml';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

type Json = Record<string, unknown>;
export interface OperationRef {
  operationId: string;
  method: string;
  path: string;
  /** JSON Pointer (chưa mã hóa URI) tới Operation Object trong spec. */
  pointer: string[];
  operation: Json;
}
export interface ContractError {
  where: string;
  message: string;
}

export function loadSpec(path: string = SPEC_PATH): Json {
  return parse(readFileSync(path, 'utf8')) as Json;
}

const encodePointer = (segments: string[]) =>
  '#/' + segments.map((s) => encodeURIComponent(s.replaceAll('~', '~0').replaceAll('/', '~1'))).join('/');

function getAt(doc: Json, segments: string[]): unknown {
  let node: unknown = doc;
  for (const s of segments) node = (node as Json | undefined)?.[s];
  return node;
}

/** `#/components/responses/NotFound` → ['components', 'responses', 'NotFound'] */
const refToSegments = (ref: string) =>
  ref.replace(/^#\//, '').split('/').map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export function createContractValidator(spec: Json = loadSpec()) {
  // [PATTERN] OpenAPI 3.1 dùng JSON Schema draft 2020-12, nên dùng đúng bản Ajv 2020; strict để bắt keyword gõ sai.
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  // Các khóa cấp gốc của OpenAPI không phải keyword JSON Schema: khai báo để strict mode không báo lỗi.
  ajv.addVocabulary(['openapi', 'info', 'servers', 'tags', 'paths', 'components', 'webhooks', 'security', 'externalDocs', 'jsonSchemaDialect']);
  ajv.addSchema(spec, SPEC_ID);
  const cache = new Map<string, ValidateFunction>();

  const compileAt = (segments: string[]): ValidateFunction => {
    const key = segments.join('\u0000');
    let fn = cache.get(key);
    if (!fn) {
      // [PATTERN] Tham chiếu vào chính nút schema trong spec, $ref nội bộ (#/components/schemas/...) tự phân giải.
      fn = ajv.compile({ $ref: SPEC_ID + encodePointer(segments) });
      cache.set(key, fn);
    }
    return fn;
  };

  const operations = (): OperationRef[] => {
    const result: OperationRef[] = [];
    for (const [path, item] of Object.entries((spec.paths ?? {}) as Record<string, Json>)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method] as Json | undefined;
        if (!operation) continue;
        result.push({ operationId: String(operation.operationId), method, path, pointer: ['paths', path, method], operation });
      }
    }
    return result;
  };

  const findOperation = (operationId: string): OperationRef => {
    const op = operations().find((o) => o.operationId === operationId);
    if (!op) throw new Error(`Spec không có operationId "${operationId}"`);
    return op;
  };

  const toErrors = (where: string, errors: ErrorObject[] | null | undefined): ContractError[] =>
    (errors ?? []).map((e) => ({ where, message: `${e.instancePath || '(gốc)'} ${e.message ?? ''}`.trim() }));

  /** Kiểm body JSON của request theo `requestBody` của operation. */
  const validateRequestBody = (operationId: string, body: unknown): ContractError[] => {
    const op = findOperation(operationId);
    const fn = compileAt([...op.pointer, 'requestBody', 'content', 'application/json', 'schema']);
    return fn(body) ? [] : toErrors(`${operationId} request`, fn.errors);
  };

  /** Kiểm một query/path parameter đã chuyển kiểu theo schema của nó trong spec. */
  const validateParameter = (operationId: string, name: string, value: unknown): ContractError[] => {
    const op = findOperation(operationId);
    const params = (op.operation.parameters ?? []) as Json[];
    const index = params.findIndex((p) => p.name === name);
    if (index < 0) return [{ where: `${operationId} ${name}`, message: 'tham số không có trong spec' }];
    const fn = compileAt([...op.pointer, 'parameters', String(index), 'schema']);
    return fn(value) ? [] : toErrors(`${operationId} ${name}`, fn.errors);
  };

  /** Kiểm status và body của response: status phải được khai báo, body phải khớp schema của status đó. */
  const validateResponse = (operationId: string, status: number, body: unknown): ContractError[] => {
    const op = findOperation(operationId);
    const responses = (op.operation.responses ?? {}) as Record<string, Json>;
    const declared = responses[String(status)];
    if (!declared) {
      return [{ where: `${operationId} ${status}`, message: `status ${status} không khai báo trong spec (có: ${Object.keys(responses).join(', ')})` }];
    }
    const base = typeof declared.$ref === 'string' ? refToSegments(declared.$ref) : [...op.pointer, 'responses', String(status)];
    const content = getAt(spec, [...base, 'content', 'application/json']);
    if (!content) return body === undefined || body === '' ? [] : [{ where: `${operationId} ${status}`, message: 'spec không khai báo body JSON' }];
    const fn = compileAt([...base, 'content', 'application/json', 'schema']);
    return fn(body) ? [] : toErrors(`${operationId} ${status}`, fn.errors);
  };

  return { spec, operations, findOperation, validateRequestBody, validateParameter, validateResponse };
}

export type ContractValidator = ReturnType<typeof createContractValidator>;
