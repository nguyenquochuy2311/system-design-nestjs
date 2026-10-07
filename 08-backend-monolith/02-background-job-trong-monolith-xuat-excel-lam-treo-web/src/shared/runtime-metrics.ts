import { Controller, Get, Query } from '@nestjs/common';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// Event loop delay đo bằng perf_hooks.monitorEventLoopDelay của Node: một timer 10 ms, mỗi lần nó chạy trễ bao nhiêu
// thì ghi vào histogram. Event loop bị chặn 3 giây thì có một mẫu khoảng 3.000 ms.
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
let since = Date.now();

const ms = (ns: number) => Number((ns / 1e6).toFixed(2));

export function snapshot(reset: boolean) {
  const mem = process.memoryUsage();
  const result = {
    since: new Date(since).toISOString(),
    now: new Date().toISOString(),
    eventLoopDelayMs: {
      count: histogram.count,
      min: ms(histogram.min),
      mean: ms(histogram.mean),
      p50: ms(histogram.percentile(50)),
      p99: ms(histogram.percentile(99)),
      max: ms(histogram.max),
    },
    memoryMb: { rss: Number((mem.rss / 2 ** 20).toFixed(1)), heapUsed: Number((mem.heapUsed / 2 ** 20).toFixed(1)) },
  };
  if (reset) {
    histogram.reset();
    since = Date.now();
  }
  return result;
}

/** Endpoint nội bộ cho script đo: `GET /internal/runtime?reset=1` trả số liệu từ lần reset trước rồi reset. */
@Controller('internal')
export class RuntimeMetricsController {
  @Get('runtime')
  runtime(@Query('reset') reset?: string) {
    return snapshot(reset === '1');
  }
}
