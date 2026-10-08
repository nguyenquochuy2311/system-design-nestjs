/**
 * [PATTERN] Test hợp đồng đi theo spec: đường dẫn, tham số mẫu và body mẫu đọc từ `openapi.yaml` theo operationId,
 * response kiểm bằng Ajv trên đúng schema của status đó. Code backend đổi mà spec không đổi → đỏ.
 */
import type { ContractError, ContractValidator, OperationRef } from '../../packages/api-contract/index.js';

export interface ContractCase {
  name: string;
  operationId: string;
  status: number;
  /** 'example': mọi tham số lấy `example` trong spec; chuỗi: mọi path parameter nhận giá trị này. */
  path?: 'example' | string;
  query?: 'example' | Record<string, string>;
  body?: 'example' | unknown;
}

export const CASES: ContractCase[] = [
  { name: 'listCustomers 200', operationId: 'listCustomers', status: 200, query: 'example' },
  { name: 'listCustomers 400 khi limit ngoài 1–50', operationId: 'listCustomers', status: 400, query: { limit: '999' } },
  { name: 'getCustomer 200', operationId: 'getCustomer', status: 200, path: 'example' },
  { name: 'getCustomer 404', operationId: 'getCustomer', status: 404, path: 'cus_999' },
  { name: 'createCustomer 201', operationId: 'createCustomer', status: 201, body: 'example' },
  { name: 'createCustomer 400 khi thiếu trường bắt buộc', operationId: 'createCustomer', status: 400, body: {} },
];

type Param = { name: string; in: string; example?: unknown };

function buildUrl(op: OperationRef, c: ContractCase): string {
  const params = (op.operation.parameters ?? []) as Param[];
  let path = op.path;
  for (const p of params.filter((p) => p.in === 'path')) {
    const value = c.path === 'example' || c.path === undefined ? String(p.example) : c.path;
    path = path.replace(`{${p.name}}`, encodeURIComponent(value));
  }
  const qs = new URLSearchParams();
  if (c.query === 'example') for (const p of params.filter((p) => p.in === 'query' && p.example !== undefined)) qs.set(p.name, String(p.example));
  else if (c.query) for (const [k, v] of Object.entries(c.query)) qs.set(k, v);
  return qs.size ? `${path}?${qs}` : path;
}

function exampleBody(op: OperationRef): unknown {
  const rb = op.operation.requestBody as { content?: Record<string, { example?: unknown }> } | undefined;
  return rb?.content?.['application/json']?.example;
}

export interface CaseResult {
  name: string;
  request: string;
  status: number;
  errors: ContractError[];
}

export async function runCase(baseUrl: string, contract: ContractValidator, c: ContractCase): Promise<CaseResult> {
  const op = contract.findOperation(c.operationId);
  const url = buildUrl(op, c);
  const body = c.body === 'example' ? exampleBody(op) : c.body;
  const res = await fetch(baseUrl + url, {
    method: op.method.toUpperCase(),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  const errors: ContractError[] = [];
  if (res.status !== c.status) errors.push({ where: c.name, message: `status ${res.status}, chờ ${c.status}` });
  errors.push(...contract.validateResponse(c.operationId, res.status, json));
  return { name: c.name, request: `${op.method.toUpperCase()} ${url}`, status: res.status, errors };
}
