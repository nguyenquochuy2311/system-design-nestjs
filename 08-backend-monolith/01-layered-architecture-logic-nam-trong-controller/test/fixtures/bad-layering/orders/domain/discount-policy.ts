// Fixture cho phép thử âm: domain ném HttpException của NestJS — dependency-cruiser phải chặn.
import { UnprocessableEntityException } from '@nestjs/common';

export function assertPositive(amount: number): void {
  if (amount <= 0) throw new UnprocessableEntityException('Số tiền phải dương');
}
