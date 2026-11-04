export interface LogEntry {
  service: string;
  event: string;
  correlationId?: string;
  [field: string]: unknown;
}

type LogSink = (entry: LogEntry & { timestamp: string }) => void;

let sink: LogSink = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

/** Test thay chỗ ghi log để đếm service và lời gọi theo correlation id mà không cần đọc stdout. */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function logEvent(entry: LogEntry): void {
  sink({ timestamp: new Date().toISOString(), ...entry });
}
