import { existsSync, readFileSync } from 'node:fs';
const run = process.argv[2];
const read = (variant) => {
  const file = `bench/results/${run}/${variant}-meta.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};
const line = (r) => `${r.failed}/${r.total} lỗi ${JSON.stringify(r.byStatus)} giây lỗi ${r.firstFailSecond}–${r.lastFailSecond}`;
const before = read('truoc');
if (before) {
  console.log(`trước/deploy: ${line(before.deploy)}, người sửa ${before.operatorSeconds} giây`);
  console.log(`trước/thêm máy: ${line(before.add.result)}, pod phục vụ ${before.add.podsServing}, máy mới nhận ${before.add.addedPodRequests}`);
  console.log(`trước/tắt máy: ${line(before.stop)}`);
  console.log(`  ngủ=${JSON.stringify(before.sleepGaps)} ${before.powerStart} → ${before.powerEnd}`);
}
const after = read('sau');
if (after) {
  for (const r of after.rollouts) console.log(`sau/rollout ${r.rolloutMs} ms: ${line(r)}`);
  if (after.scale) console.log(`sau/scale: ${line(after.scale)} ${JSON.stringify(after.scale.pods)}`);
  for (const r of after.readiness ?? []) {
    console.log(`sau/readiness: gỡ EndpointSlice ${r.endpointRemovedMs} ms, request cuối ${r.lastRequestMs} ms, khởi động lại ${r.restartsBefore}→${r.restarts}, ${line(r)}`);
  }
  for (const r of after.skew ?? []) console.log(`sau/chênh lệch tuổi ${r.ageMs}: ${r.spreadPercent} % ${JSON.stringify(r.counts)} ${r.seconds} giây, ${line(r)}`);
  console.log(`  ngủ=${JSON.stringify(after.sleepGaps)} ${after.powerStart} → ${after.powerEnd}`);
}
