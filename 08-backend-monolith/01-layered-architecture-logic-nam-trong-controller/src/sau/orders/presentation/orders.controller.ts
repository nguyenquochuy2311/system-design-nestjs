import { Body, Controller, HttpCode, Inject, Post, UseFilters } from '@nestjs/common';
import { PlaceOrderService, type PlacedOrder } from '../application/place-order.service';
import { OrderErrorFilter } from './order-error.filter';
import { parsePlaceOrderBody } from './place-order.dto';

/** Controller mỏng: đọc body, gọi service, để filter ánh xạ lỗi. Không import repository hay Kysely. */
@Controller('sau/orders')
@UseFilters(OrderErrorFilter)
export class OrdersController {
  constructor(@Inject(PlaceOrderService) private readonly placeOrderService: PlaceOrderService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): Promise<PlacedOrder> {
    const { customerId, items } = parsePlaceOrderBody(body);
    return this.placeOrderService.placeOrder({ customerId, items, channel: 'web' });
  }
}
