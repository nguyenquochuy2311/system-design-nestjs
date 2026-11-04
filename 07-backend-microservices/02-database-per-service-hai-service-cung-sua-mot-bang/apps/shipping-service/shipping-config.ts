import type { Generated } from 'kysely';

export const SHIPPING_CONFIG = Symbol('SHIPPING_CONFIG');

export interface ShippingConfig {
  databaseUrl: string;
  /** single: cột address; split: street, ward, district sau migration 002. */
  addressModel: 'single' | 'split';
  pollMs: number;
}

export interface ShippingTables {
  shipment_orders: {
    order_id: string;
    address?: string;
    street?: string;
    ward?: string;
    district?: string;
    delivery_window: string;
    zone_code: string;
    order_version: number;
    event_occurred_at: Date;
    created_at: Generated<Date>;
    replicated_at: Generated<Date>;
  };
  quarantined_events: { msg_id: number; reason: string; payload: string };
}
