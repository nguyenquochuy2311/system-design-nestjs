import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { CustomersRepository, type Customer } from './customers.repository';

interface CustomerBody {
  name?: unknown;
  email?: unknown;
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new BadRequestException(`Thiếu ${field}`);
  return v.trim();
}

@Controller()
export class CustomersController {
  constructor(@Inject(CustomersRepository) private readonly repo: CustomersRepository) {}

  @Get('health')
  health(): Promise<{ role: string; serverVersion: string }> {
    return this.repo.whoAmI();
  }

  @Post('customers')
  create(@Body() body: CustomerBody): Promise<Customer> {
    return this.repo.create(text(body.name, 'name'), text(body.email, 'email'));
  }

  @Get('customers/:id')
  async get(@Param('id') id: string): Promise<Customer> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Patch('customers/:id')
  async rename(@Param('id') id: string, @Body() body: CustomerBody): Promise<Customer> {
    const c = await this.repo.rename(id, text(body.name, 'name'));
    if (!c) throw new NotFoundException();
    return c;
  }

  @Delete('customers/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    if (!(await this.repo.remove(id))) throw new NotFoundException();
  }
}
