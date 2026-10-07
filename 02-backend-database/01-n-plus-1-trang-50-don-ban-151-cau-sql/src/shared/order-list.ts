export const PAGE_SIZE = 50;

export interface OrderListItem {
  id: number;
  status: string;
  totalCents: number;
  createdAt: Date;
  customer: { id: number; name: string };
  items: { id: number; productName: string; quantity: number; priceCents: number }[];
  shipment: { status: string; carrier: string } | null;
}
