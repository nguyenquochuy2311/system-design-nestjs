import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CustomerStore } from '../shared/customer-store.js';
import { assertRequestBody, parseQueryInt } from './contract.js';
import { type CustomerBody, CustomerPresenter } from './customer.presenter.js';

interface CreateCustomerBody {
  name: string;
  email: string;
  phone?: string | null;
  tier: CustomerBody['tier'];
  address: { line1: string; city: string };
  tags?: string[];
}

// Mỗi handler ghi operationId của spec; test hợp đồng đi theo operationId, không theo đường dẫn viết tay.
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CustomerStore) private readonly store: CustomerStore,
    @Inject(CustomerPresenter) private readonly presenter: CustomerPresenter,
  ) {}

  /** operationId: listCustomers */
  @Get()
  list(@Query('limit') limit?: string): { value: CustomerBody[] } {
    const n = parseQueryInt('listCustomers', 'limit', limit, 20); // [PATTERN] giới hạn 1–50 lấy từ spec
    return { value: this.store.list(n).map((r) => this.presenter.toBody(r)) };
  }

  /** operationId: getCustomer */
  @Get(':customerId')
  get(@Param('customerId') customerId: string): CustomerBody {
    const row = this.store.find(customerId);
    if (!row) throw new NotFoundException(`Không có khách hàng ${customerId}`);
    return this.presenter.toBody(row);
  }

  /** operationId: createCustomer */
  @Post()
  @HttpCode(201)
  create(@Body() body: CreateCustomerBody): CustomerBody {
    assertRequestBody('createCustomer', body); // [PATTERN] request sai hợp đồng → 400 ErrorResponse
    const row = this.store.create({
      companyName: body.name, email: body.email, phone: body.phone ?? null, tier: body.tier,
      billingStreet: body.address.line1, billingCity: body.address.city, tags: body.tags ?? [], taxCode: null,
    });
    return this.presenter.toBody(row);
  }
}
