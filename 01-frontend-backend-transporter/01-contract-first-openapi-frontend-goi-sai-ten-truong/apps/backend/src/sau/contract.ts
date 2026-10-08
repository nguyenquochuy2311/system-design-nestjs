/**
 * Nối spec vào NestJS: kiểm request theo spec lúc chạy, và trả lỗi đúng định dạng `ErrorResponse` của spec.
 * Response KHÔNG kiểm ở đây (tốn CPU ở production); test hợp đồng kiểm response (README mục 3.3).
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { createContractValidator, type ContractError } from '../../../../packages/api-contract/index.js';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

// [PATTERN] Một validator nạp từ cùng file spec mà web dùng để sinh type.
export const contract = createContractValidator();

export class ContractViolation extends HttpException {
  constructor(readonly errors: ContractError[]) {
    super('Request không khớp hợp đồng', HttpStatus.BAD_REQUEST);
  }
}

export function assertRequestBody(operationId: string, body: unknown): void {
  const errors = contract.validateRequestBody(operationId, body);
  if (errors.length) throw new ContractViolation(errors);
}

export function parseQueryInt(operationId: string, name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  const errors = contract.validateParameter(operationId, name, value);
  if (errors.length) throw new ContractViolation(errors);
  return value;
}

/** Lỗi theo Microsoft REST API Guidelines: { error: { code, message, details? } }. */
@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();
    if (exception instanceof ContractViolation) {
      res.status(400).json({
        error: {
          code: 'InvalidRequest',
          message: exception.message,
          details: exception.errors.map((e) => ({ code: 'SchemaViolation', message: e.message, target: e.where })),
        },
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NotFound' : status === 400 ? 'InvalidRequest' : `Http${status}`;
      res.status(status).json({ error: { code, message: exception.message } });
      return;
    }
    console.error('Lỗi không bắt được', exception);
    res.status(500).json({ error: { code: 'InternalError', message: 'Lỗi máy chủ' } });
  }
}
