// Số time series mỗi service (mục 5 của README) đọc từ Prometheus thật: đếm series có label service_name, tách theo
// metric, và trang TSDB Status (/api/v1/status/tsdb). Chạy sau game day/overhead để có đủ tổ hợp status/route.
// Chạy: pnpm bench:series [--out main] [--window <phút, mặc định 60>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { URLS, promQuery } from '../test/support/stack.js';

const { values: args } = parseArgs({ options: { out: { type: 'string', default: 'main' }, window: { type: 'string', default: '60' } } });
mkdirSync(`bench/results/${args.out}`, { recursive: true });

// Series thô từ service (không tính series do recording rule tạo, tên có dấu `:`).
const perService = await promQuery('count by (service_name) ({service_name=~".+", __name__!~".*:.*"})');
const perMetric = await promQuery('count by (service_name, __name__) ({service_name=~".+", __name__!~".*:.*"})');
const ruleSeries = await promQuery('count({__name__=~".*:.*"})');
// Mọi series từng có trong cửa sổ (gồm tổ hợp status/lỗi chỉ xuất hiện lúc game day, đã hết hạn ở Collector), đọc
// bằng API /api/v1/series.
const minutes = Number(args.window);
const seriesRes = (await (
  await fetch(`${URLS.prometheus}/api/v1/series?${new URLSearchParams({ 'match[]': '{service_name=~".+", __name__!~".*:.*"}', start: String(Date.now() / 1000 - minutes * 60), end: String(Date.now() / 1000) })}`)
).json()) as { data: Record<string, string>[] };
const tally = (key: (m: Record<string, string>) => string) => {
  const t: Record<string, number> = {};
  for (const m of seriesRes.data) t[key(m)] = (t[key(m)] ?? 0) + 1;
  return t;
};
const perServiceWindow = tally((m) => m.service_name!);
const perMetricWindow = Object.entries(tally((m) => `${m.service_name} ${m.__name__}`))
  .map(([k, v]) => ({ service: k.split(' ')[0], metric: k.split(' ')[1], series: v }))
  .sort((a, b) => (a.service ?? '').localeCompare(b.service ?? '') || b.series - a.series);
const tsdb = (await (await fetch(`${URLS.prometheus}/api/v1/status/tsdb`)).json()) as { data: { headStats: Record<string, number>; seriesCountByMetricName: { name: string; value: number }[] } };

const result = {
  at: new Date().toISOString(),
  perService: Object.fromEntries(perService.map((s) => [s.metric.service_name, Number(s.value[1])])),
  perMetric: perMetric
    .map((s) => ({ service: s.metric.service_name, metric: s.metric.__name__, series: Number(s.value[1]) }))
    .sort((a, b) => (a.service ?? '').localeCompare(b.service ?? '') || b.series - a.series),
  windowMinutes: minutes,
  perServiceWindow,
  perMetricWindow,
  recordingRuleSeries: Number(ruleSeries[0]?.value[1] ?? 0),
  headStats: tsdb.data.headStats,
  topMetrics: tsdb.data.seriesCountByMetricName.slice(0, 10),
};
writeFileSync(`bench/results/${args.out}/series-count.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ perService: result.perService, perServiceWindow: result.perServiceWindow, headSeries: result.headStats.numSeries, top: result.topMetrics.slice(0, 5) }, null, 2));
