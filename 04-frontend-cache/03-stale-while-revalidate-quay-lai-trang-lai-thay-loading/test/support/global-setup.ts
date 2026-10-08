import { ensureWebBuild, startApi, startWeb, type Proc } from './lab';

// Một lần cho cả lượt test: build Next (bỏ qua nếu bản build khớp hash mã nguồn), bật API và Next như tiến trình riêng.
// Phép thử âm sửa web/ thì hash đổi và lượt test đó tự build lại.
export default async function setup(): Promise<() => Promise<void>> {
  const build = ensureWebBuild(false);
  if (build.built) console.log(`next build web: ${build.seconds} s (hash ${build.hash})`);
  const procs: Proc[] = [];
  try {
    procs.push(await startApi());
    procs.push(await startWeb());
  } catch (e) {
    for (const p of procs.reverse()) await p.stop();
    throw e;
  }
  return async () => {
    for (const p of procs.reverse()) await p.stop();
  };
}
