export interface ProviderUrls {
  orderUrl: string;
  paymentUrl: string;
  shippingUrl: string;
  customerUrl: string;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (response.status !== 200) {
    throw new Error(`${url} trả ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Bản "trước": logic ghép nằm ở client. Gọi tuần tự vì lời gọi sau cần customerId từ lời gọi trước, và một lỗi là lỗi toàn
 * trang. k6 ở bench/ chạy đúng trình tự này.
 */
export async function loadOrderDetail(urls: ProviderUrls, orderId: string) {
  const order = await getJson(`${urls.orderUrl}/orders/${orderId}`);
  const payment = await getJson(`${urls.paymentUrl}/payments/${orderId}`);
  const shipping = await getJson(`${urls.shippingUrl}/shipments/${orderId}`);
  const customer = await getJson(`${urls.customerUrl}/customers/${String(order.customer_id)}`);
  return { order, payment, shipping, customer };
}

/** Màn hình danh sách: một lời gọi lấy đơn rồi 3 lời gọi cho mỗi đơn, N+1 xuyên service. */
export async function loadOrderList(urls: ProviderUrls, customerId: string) {
  const response = await fetch(`${urls.orderUrl}/orders?customerId=${customerId}`);
  const orders = (await response.json()) as { id: string; customer_id: string }[];
  const rows = [];
  for (const order of orders) {
    rows.push({
      order,
      payment: await getJson(`${urls.paymentUrl}/payments/${order.id}`),
      shipping: await getJson(`${urls.shippingUrl}/shipments/${order.id}`),
      customer: await getJson(`${urls.customerUrl}/customers/${order.customer_id}`),
    });
  }
  return rows;
}
