import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CustomerStore } from '../shared/customer-store.js';
import { CreateCustomerDto, CustomerDto, CustomerPresenter } from './customer.dto.js';

@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CustomerStore) private readonly store: CustomerStore,
    @Inject(CustomerPresenter) private readonly presenter: CustomerPresenter,
  ) {}

  @Get()
  list(@Query('limit') limit?: string): { value: CustomerDto[] } {
    return { value: this.store.list(limit ? Number(limit) : 20).map((r) => this.presenter.toDto(r)) };
  }

  @Get(':customerId')
  get(@Param('customerId') customerId: string): CustomerDto {
    const row = this.store.find(customerId);
    if (!row) throw new NotFoundException(`Không có khách hàng ${customerId}`);
    return this.presenter.toDto(row);
  }

  @Post()
  create(@Body() body: CreateCustomerDto): CustomerDto {
    // Kiểm tra tay, mỗi endpoint một kiểu; quy tắc không nằm ở đâu ngoài code này.
    if (!body?.name || !body.email || !body.tier || !body.address?.city) throw new BadRequestException('Thiếu trường bắt buộc');
    const row = this.store.create({
      companyName: body.name, email: body.email, phone: body.phone ?? null, tier: body.tier,
      billingStreet: body.address.line1, billingCity: body.address.city, tags: body.tags ?? [], taxCode: null,
    });
    return this.presenter.toDto(row);
  }
}
