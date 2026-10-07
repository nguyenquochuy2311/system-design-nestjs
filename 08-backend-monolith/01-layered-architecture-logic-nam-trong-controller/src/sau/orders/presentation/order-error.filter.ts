import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { CreditLimitExceededError, CustomerNotFoundError, OrderRuleError, UnknownProductError } from '../domain/order';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Ánh xạ lỗi nghiệp vụ sang HTTP ở đúng một chỗ của lớp presentation; body giữ nguyên như bản cũ. */
@Catch(OrderRuleError)
export class OrderErrorFilter implements ExceptionFilter<OrderRuleError> {
  catch(error: OrderRuleError, host: ArgumentsHost): void {
    const [status, body] = toHttp(error);
    host.switchToHttp().getResponse<JsonResponse>().status(status).json(body);
  }
}

function toHttp(error: OrderRuleError): [number, Record<string, unknown>] {
  if (error instanceof CustomerNotFoundError) {
    return [404, { statusCode: 404, message: error.message, error: 'Not Found' }];
  }
  if (error instanceof CreditLimitExceededError) {
    return [422, { statusCode: 422, error: 'credit_limit_exceeded', message: error.message, shortfall: error.shortfall }];
  }
  const code = error instanceof UnknownProductError ? 'unknown_product' : 'order_rule_violated';
  return [422, { statusCode: 422, error: code, message: error.message }];
}
