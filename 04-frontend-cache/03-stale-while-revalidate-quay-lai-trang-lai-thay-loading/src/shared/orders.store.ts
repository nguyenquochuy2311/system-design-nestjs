// Kho đơn hàng trong bộ nhớ: seed tất định, ghi lại MỌI thay đổi (seq, thời điểm, bản sau thay đổi) để script đo
// dựng lại được "đúng ra danh sách phải hiện gì" ở bất kỳ thời điểm nào và tính độ cũ của màn hình.
// Không có database: bài đo hành vi cache phía client, độ chậm của API là độ trễ giả lập (config.ts).
import { Injectable } from '@nestjs/common';
import { PAGE_SIZE, type Order, type OrderFilters, type OrderRow, type OrderStatus, type Warehouse } from '../../web/orders/contracts';

export interface Region {
  id: string;
  name: string;
  warehouses: Warehouse[];
}

export const REGIONS: Region[] = [
  { id: 'Q1', name: 'Quận 1', warehouses: [{ id: 'kho-q1-a', name: 'Kho Bến Nghé' }, { id: 'kho-q1-b', name: 'Kho Đa Kao' }] },
  { id: 'Q7', name: 'Quận 7', warehouses: [{ id: 'kho-q7-a', name: 'Kho Tân Phong' }, { id: 'kho-q7-b', name: 'Kho Tân Thuận' }] },
  { id: 'TD', name: 'Thủ Đức', warehouses: [{ id: 'kho-td-a', name: 'Kho Linh Trung' }, { id: 'kho-td-b', name: 'Kho Hiệp Phú' }] },
];

export const ORDERS_PER_REGION = 300;

/** Điều phối viên giả lập: uid kết thúc bằng số (d01, sau-d07...), khu vực theo số đó. Cùng số = cùng khu vực ở mọi bản. */
export function dispatcherOf(uid: string): { uid: string; name: string; region: Region } {
  const n = Number(/(\d+)$/.exec(uid)?.[1] ?? '1');
  const region = REGIONS[(Math.max(n, 1) - 1) % REGIONS.length]!;
  return { uid, name: `Điều phối viên ${String(n).padStart(2, '0')}`, region };
}

export interface Change {
  seq: number;
  t: number;
  orderId: string;
  /** Ai đổi: uid của điều phối viên giả lập, hoặc 'khac' (shipper, điều phối viên ngoài lượt đo). */
  by: string;
  after: Order;
}

export interface HistoryDump {
  seed: number;
  t0: number;
  initial: Order[];
  changes: Change[];
}

/** PRNG có hạt (mulberry32), cùng thuật toán với bench/lib.ts. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Huỳnh'];
const DEM = ['Văn', 'Thị', 'Minh', 'Ngọc', 'Quốc', 'Thanh', 'Gia', 'Hữu'];
const TEN = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa', 'Lan', 'Minh', 'Nam', 'Phương', 'Quân', 'Thảo', 'Trang', 'Vy'];
const DUONG = ['Lê Lợi', 'Nguyễn Huệ', 'Hai Bà Trưng', 'Nguyễn Thị Thập', 'Võ Văn Ngân', 'Lê Văn Việt', 'Điện Biên Phủ', 'Huỳnh Tấn Phát'];

/** Danh sách đúng như API trả ở một trạng thái dữ liệu: dùng chung cho API và script phân tích độ cũ. */
export function listOrders(orders: Iterable<Order>, region: string, f: OrderFilters): { items: OrderRow[]; total: number; pageCount: number } {
  const matched = [...orders]
    .filter((o) => o.region === region && (f.status === 'tat-ca' || o.status === f.status) && (f.warehouse === 'tat-ca' || o.warehouse === f.warehouse))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const items = matched.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE).map(toRow);
  return { items, total: matched.length, pageCount };
}

export const toRow = (o: Order): OrderRow => ({
  id: o.id,
  code: o.code,
  warehouse: o.warehouse,
  customer: o.customer,
  address: o.address,
  status: o.status,
  assignee: o.assignee,
  updatedAt: o.updatedAt,
});

@Injectable()
export class OrderStore {
  private orders = new Map<string, Order>();
  private changes: Change[] = [];
  private initial: Order[] = [];
  private seqNo = 0;
  private nextNo = 1;
  private seed = 42;
  private t0 = Date.now();
  private random: () => number = rng(42);

  constructor() {
    this.reset(42);
  }

  get seq(): number {
    return this.seqNo;
  }

  reset(seed: number): { t0: number; seed: number; orders: number } {
    this.seed = seed;
    this.random = rng(seed);
    this.orders.clear();
    this.changes = [];
    this.seqNo = 0;
    this.nextNo = 1;
    this.t0 = Date.now();
    for (const region of REGIONS) {
      for (let i = 0; i < ORDERS_PER_REGION; i++) {
        // Đơn cũ hơn ở cuối danh sách: tạo trong 8 giờ trước lúc seed. Đơn mới nhất phần lớn còn "Mới".
        const age = (i / ORDERS_PER_REGION) * 8 * 3600_000;
        const r = this.random();
        const status: OrderStatus = i < 120 ? (r < 0.85 ? 'moi' : 'da-nhan') : r < 0.3 ? 'da-nhan' : r < 0.7 ? 'dang-giao' : 'da-giao';
        this.insert(region, this.t0 - age, status);
      }
    }
    this.initial = [...this.orders.values()].map((o) => ({ ...o }));
    return { t0: this.t0, seed, orders: this.orders.size };
  }

  private insert(region: Region, createdAt: number, status: OrderStatus): Order {
    const no = this.nextNo++;
    const pick = <T>(xs: T[]) => xs[Math.floor(this.random() * xs.length)]!;
    const order: Order = {
      id: `o${String(no).padStart(5, '0')}`,
      code: `GH${region.id}-${String(10_000 + no)}`,
      region: region.id,
      warehouse: pick(region.warehouses).id,
      customer: `${pick(HO)} ${pick(DEM)} ${pick(TEN)}`,
      phone: `09${String(Math.floor(this.random() * 1e8)).padStart(8, '0')}`,
      address: `${1 + Math.floor(this.random() * 300)} ${pick(DUONG)}, ${region.name}`,
      codAmount: 50_000 + Math.floor(this.random() * 40) * 25_000,
      status,
      assignee: status === 'moi' ? null : `Shipper ${String(1 + Math.floor(this.random() * 40)).padStart(2, '0')}`,
      createdAt,
      updatedAt: createdAt,
    };
    this.orders.set(order.id, order);
    return order;
  }

  private record(order: Order, by: string): Change {
    const change: Change = { seq: ++this.seqNo, t: Date.now(), orderId: order.id, by, after: { ...order } };
    this.changes.push(change);
    return change;
  }

  list(region: string, f: OrderFilters) {
    return { ...listOrders(this.orders.values(), region, f), seq: this.seqNo };
  }

  get(id: string): Order | undefined {
    const o = this.orders.get(id);
    return o && { ...o };
  }

  /** Phân đơn cho shipper. Chỉ đơn còn "Mới" mới nhận được; đơn đã có người nhận trả 'conflict' (API trả 409). */
  assign(id: string, shipper: string, by: string): { order: Order; seq: number } | 'conflict' | undefined {
    const o = this.orders.get(id);
    if (!o) return undefined;
    if (o.status !== 'moi') return 'conflict';
    o.status = 'da-nhan';
    o.assignee = shipper;
    o.updatedAt = Date.now();
    const c = this.record(o, by);
    return { order: { ...o }, seq: c.seq };
  }

  /** Đổi tùy ý (route /ops cho test). */
  change(id: string, patch: { status?: OrderStatus; assignee?: string | null }, by = 'khac'): Change | undefined {
    const o = this.orders.get(id);
    if (!o) return undefined;
    if (patch.status) o.status = patch.status;
    if (patch.assignee !== undefined) o.assignee = patch.assignee;
    o.updatedAt = Date.now();
    return this.record(o, by);
  }

  create(regionId: string, by = 'khac'): Change {
    const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0]!;
    const o = this.insert(region, Date.now(), 'moi');
    return this.record(o, by);
  }

  /**
   * Một việc của "người khác" trong khu vực (shipper nhận đơn, điều phối viên ngoài lượt đo, đơn mới vào), chọn bằng
   * PRNG của kho: cùng hạt và cùng thứ tự gọi thì cùng chuỗi thay đổi.
   */
  othersTick(regionId: string): Change | undefined {
    const inRegion = [...this.orders.values()].filter((o) => o.region === regionId).sort((a, b) => a.id.localeCompare(b.id));
    const of = (s: OrderStatus) => inRegion.filter((o) => o.status === s);
    const pick = (xs: Order[]) => xs[Math.floor(this.random() * xs.length)];
    const r = this.random();
    // Giữ hàng đợi "Mới" khoảng 100 đơn mỗi khu vực: đơn mới vào khi hàng đợi vơi. Không có điều này, lượt đo một giờ đầu
    // tiên làm cạn đơn "Mới" sau khoảng 40 phút (người khác nhận khoảng 99 đơn/giờ, 9 điều phối viên phân thêm khoảng 90).
    if (r < 0.15 || of('moi').length < 100) return this.create(regionId);
    if (r < 0.7) {
      const o = pick(of('moi'));
      return o && this.change(o.id, { status: 'da-nhan', assignee: `Shipper ${String(1 + Math.floor(this.random() * 40)).padStart(2, '0')}` });
    }
    if (r < 0.95) {
      const o = pick(of('da-nhan'));
      return o && this.change(o.id, { status: 'dang-giao' });
    }
    const o = pick(of('dang-giao'));
    return o && this.change(o.id, { status: 'da-giao' });
  }

  history(): HistoryDump {
    return { seed: this.seed, t0: this.t0, initial: this.initial, changes: this.changes };
  }
}
