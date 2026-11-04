export interface HopSummary {
  /** Số request đặt hàng thành công có đủ log. */
  orders: number;
  /** Tên các service xuất hiện trong log của một đơn, kể cả cửa vào. */
  serviceNames: string[];
  servicesPerOrder: { min: number; max: number };
  outboundCallsPerOrder: { min: number; max: number };
}

interface ParsedLine {
  service?: string;
  event?: string;
  correlationId?: string;
  method?: string;
  path?: string;
  status?: number;
}

function parseLine(line: string): ParsedLine | undefined {
  const start = line.indexOf('{');
  if (start < 0) {
    return undefined;
  }
  try {
    return JSON.parse(line.slice(start)) as ParsedLine;
  } catch {
    return undefined;
  }
}

/** Nhóm dòng log theo correlation id; chỉ tính request POST /orders ở cửa vào đã trả 201. */
export function countHops(logLines: string[], entryService: string): HopSummary {
  const byRequest = new Map<string, ParsedLine[]>();
  for (const line of logLines) {
    const parsed = parseLine(line);
    if (parsed?.correlationId) {
      byRequest.set(parsed.correlationId, [...(byRequest.get(parsed.correlationId) ?? []), parsed]);
    }
  }
  const completed = [...byRequest.values()].filter((lines) =>
    lines.some(
      (line) =>
        line.service === entryService &&
        line.event === 'inbound' &&
        line.method === 'POST' &&
        line.path === '/orders' &&
        line.status === 201,
    ),
  );
  const services = completed.map((lines) => new Set(lines.map((line) => line.service)));
  const outbound = completed.map((lines) => lines.filter((line) => line.event === 'outbound').length);
  const sizes = services.map((set) => set.size);
  return {
    orders: completed.length,
    serviceNames: [...new Set(services.flatMap((set) => [...set]))].filter((name) => name !== undefined).sort(),
    servicesPerOrder: { min: Math.min(...sizes), max: Math.max(...sizes) },
    outboundCallsPerOrder: { min: Math.min(...outbound), max: Math.max(...outbound) },
  };
}
