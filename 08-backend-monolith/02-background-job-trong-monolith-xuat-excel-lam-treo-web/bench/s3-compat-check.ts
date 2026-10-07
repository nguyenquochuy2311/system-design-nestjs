/**
 * Kiểm dịch vụ S3-compatible (RustFS thay MinIO) bằng đúng các thao tác lab cần, chạy thật, không giả lập:
 * PutObject, upload dạng stream qua @aws-sdk/lib-storage (một part và multipart), presigned GET tải bằng curl,
 * URL hết hạn bị từ chối, chữ ký sai bị từ chối, ghi đè cùng khóa, presigned PUT (scope 15 sẽ cần).
 *   RUN=main pnpm bench:s3   → bench/results/<RUN>/s3-compat.json
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/shared/config';
import { createS3Client, ensureBucket, S3ObjectStorage } from '../src/shared/object-storage';

const OUT = join('bench/results', process.env.RUN ?? 'main');
mkdirSync(OUT, { recursive: true });
const cfg = loadConfig();
const s3 = createS3Client(cfg.s3);
const bucket = 's3-compat-check';
const storage = new S3ObjectStorage(s3, bucket);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Check { name: string; expected: string; observed: string; pass: boolean }
const checks: Check[] = [];
const record = (name: string, expected: string, observed: string, pass: boolean) => {
  checks.push({ name, expected, observed, pass });
  console.log(`${pass ? 'ĐẠT ' : 'LỖI '} ${name}: ${observed}`);
};

/** curl thật: trả mã HTTP, body và vài header. */
function curl(url: string, extra: string[] = []): { status: number; body: Buffer; headers: string } {
  const bodyFile = join(tmpdir(), `s3check-${randomBytes(4).toString('hex')}`);
  const headerFile = `${bodyFile}.h`;
  const res = spawnSync('curl', ['-sS', '-o', bodyFile, '-D', headerFile, '-w', '%{http_code}', ...extra, url], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`curl lỗi: ${res.stderr}`);
  return { status: Number(res.stdout), body: readFileSync(bodyFile), headers: readFileSync(headerFile, 'utf8') };
}
const errorCode = (body: Buffer) => /<Code>([^<]+)<\/Code>/.exec(body.toString('utf8'))?.[1] ?? '(không có)';

await ensureBucket(s3, bucket);
await ensureBucket(s3, bucket); // gọi lần hai: phải idempotent
record('CreateBucket / HeadBucket idempotent', 'không lỗi khi gọi hai lần', 'không lỗi', true);

// 1. PutObject nhỏ với cấu hình checksum mặc định của SDK v3 (CRC32 khi được hỗ trợ)
const small = Buffer.from('xin chào, S3-compatible\n');
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: 'small.txt', Body: small, ContentType: 'text/plain' }));
const headSmall = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'small.txt' }));
record('PutObject (client-s3, checksum mặc định)', `ContentLength ${small.length}`, `ContentLength ${headSmall.ContentLength}`, headSmall.ContentLength === small.length);

// 2. Upload stream ngắn hơn một part → một PutObject
async function streamUpload(key: string, bytes: number, chunk = 64 * 1024): Promise<Buffer> {
  const pass = new PassThrough();
  const parts: Buffer[] = [];
  const done = storage.uploadStream(key, pass, 'application/octet-stream');
  for (let written = 0; written < bytes; written += chunk) {
    const b = randomBytes(Math.min(chunk, bytes - written));
    parts.push(b);
    if (!pass.write(b)) await new Promise((r) => pass.once('drain', r));
  }
  pass.end();
  await done;
  return Buffer.concat(parts);
}
const oneShot = await streamUpload('stream-small.bin', 1024 * 1024);
const headOne = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'stream-small.bin' }));
record('lib-storage stream 1 MiB (một part)', `ContentLength ${oneShot.length}, ETag không có hậu tố -N`, `ContentLength ${headOne.ContentLength}, ETag ${headOne.ETag}`,
  headOne.ContentLength === oneShot.length && !/-\d+"?$/.test(headOne.ETag ?? ''));

// 3. Upload stream 12 MiB → multipart 3 part (5 + 5 + 2 MiB)
const multi = await streamUpload('stream-multipart.bin', 12 * 1024 * 1024);
const headMulti = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'stream-multipart.bin' }));
record('lib-storage stream 12 MiB (multipart)', `ContentLength ${multi.length}, ETag hậu tố -3`, `ContentLength ${headMulti.ContentLength}, ETag ${headMulti.ETag}`,
  headMulti.ContentLength === multi.length && /-3"?$/.test(headMulti.ETag ?? ''));

// 4. Presigned GET tải bằng curl, nội dung khớp từng byte; ResponseContentDisposition được trả về
const signedAt = Date.now();
const url = await storage.presignDownload('stream-multipart.bin', 'bao-cao.xlsx', 5);
const got = curl(url);
const disp = /content-disposition:\s*([^\r\n]+)/i.exec(got.headers)?.[1] ?? '(không có)';
record('Presigned GET bằng curl (TTL 5 s)', `200, sha256 ${sha(multi).slice(0, 12)}…`, `${got.status}, sha256 ${sha(got.body).slice(0, 12)}…`, got.status === 200 && sha(got.body) === sha(multi));
record('Presigned GET trả Content-Disposition theo ResponseContentDisposition', 'attachment; filename="bao-cao.xlsx"', disp, disp.includes('bao-cao.xlsx'));

// 5. Chữ ký bị sửa → 403
const tampered = url.replace(/X-Amz-Signature=([0-9a-f])/, (_m, c: string) => `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`);
const bad = curl(tampered);
record('Presigned GET chữ ký bị sửa', '403 SignatureDoesNotMatch', `${bad.status} ${errorCode(bad.body)}`, bad.status === 403);

// 6. Còn hạn ở giây thứ 3 → 200; quá hạn ở giây thứ 7 → 403 (TTL 5 s)
await sleep(Math.max(0, signedAt + 3000 - Date.now()));
const stillValid = curl(url);
record('Presigned GET ở giây thứ 3 (TTL 5 s)', '200', `${stillValid.status}`, stillValid.status === 200);
await sleep(Math.max(0, signedAt + 7000 - Date.now()));
const expired = curl(url);
const expiredMsg = /<Message>([^<]+)<\/Message>/.exec(expired.body.toString('utf8'))?.[1] ?? '';
record('Presigned GET ở giây thứ 7 (TTL 5 s)', '403', `${expired.status} ${errorCode(expired.body)} ${expiredMsg}`.trim(), expired.status === 403);

// 7. Ký bằng secret sai → 403
const wrong = createS3Client({ ...cfg.s3, secretAccessKey: 'sai-secret' });
const wrongUrl = await getSignedUrl(wrong, new GetObjectCommand({ Bucket: bucket, Key: 'small.txt' }), { expiresIn: 60 });
const wrongRes = curl(wrongUrl);
record('Presigned GET ký bằng secret sai', '403', `${wrongRes.status} ${errorCode(wrongRes.body)}`, wrongRes.status === 403);

// 8. Ghi đè cùng khóa (job chạy lại ghi lại file)
const v2 = await streamUpload('stream-small.bin', 256 * 1024);
const again = curl(await storage.presignDownload('stream-small.bin', 'x.bin', 60));
record('Ghi đè cùng khóa bằng stream', `nội dung mới ${v2.length} byte`, `${again.status}, ${again.body.length} byte, khớp=${sha(again.body) === sha(v2)}`, again.status === 200 && sha(again.body) === sha(v2));

// 9. Presigned PUT bằng curl (dùng cho scope 15)
const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: 'presigned-put.bin' }), { expiresIn: 60 });
const payload = randomBytes(300 * 1024);
const payloadFile = join(tmpdir(), `s3check-put-${randomBytes(4).toString('hex')}`);
writeFileSync(payloadFile, payload);
const put = curl(putUrl, ['-X', 'PUT', '--data-binary', `@${payloadFile}`]);
const putBack = curl(await storage.presignDownload('presigned-put.bin', 'p.bin', 60));
record('Presigned PUT bằng curl rồi tải lại', '200, nội dung khớp', `${put.status}, tải lại ${putBack.status}, khớp=${sha(putBack.body) === sha(payload)}`, put.status === 200 && sha(putBack.body) === sha(payload));

// 10. Xóa rồi tải → 404
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'small.txt' }));
const gone = curl(await storage.presignDownload('small.txt', 's.txt', 60));
record('Presigned GET sau DeleteObject', '404 NoSuchKey', `${gone.status} ${errorCode(gone.body)}`, gone.status === 404);

const health = curl(`${cfg.s3.endpoint}/health`);
const result = {
  endpoint: cfg.s3.endpoint,
  server: health.body.toString('utf8'),
  sdk: '@aws-sdk/client-s3, lib-storage, s3-request-presigner 3.1147.0 (cấu hình checksum mặc định)',
  checkedAt: new Date().toISOString(),
  passed: checks.filter((c) => c.pass).length,
  total: checks.length,
  checks,
  notChecked: ['Lifecycle', 'Versioning', 'Object Lock', 'CORS', 'SSE/KMS', 'virtual-hosted-style', 'nhiều node / erasure coding', 'IAM user/policy ngoài khóa root'],
};
writeFileSync(join(OUT, 's3-compat.json'), JSON.stringify(result, null, 2));
console.log(`\n${result.passed}/${result.total} đạt → ${join(OUT, 's3-compat.json')}`);
process.exit(result.passed === result.total ? 0 : 1);
