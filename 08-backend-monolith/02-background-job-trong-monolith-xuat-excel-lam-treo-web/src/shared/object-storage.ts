import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { AppConfig } from './config';

/** Token DI cho nơi lưu file kết quả; test thay bằng bản lỗi để thử nhánh "hết lượt thử". */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  /** Ghi cả stream lên một khóa; ghi lại cùng khóa thì đè (job chạy lại không sinh file rác). */
  uploadStream(key: string, body: Readable, contentType: string): Promise<void>;
  /** URL tải có hạn (presigned GET), client tải thẳng từ object storage, không qua web process. */
  presignDownload(key: string, filename: string, ttlSeconds: number): Promise<string>;
}

export function createS3Client(cfg: AppConfig['s3']): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true, // RustFS chỉ nhận path-style khi chưa cấu hình server domain
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw err;
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (createErr) {
      // web và worker có thể cùng tạo bucket lúc khởi động
      const name = (createErr as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw createErr;
    }
  }
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
    // lib-storage chia stream thành part 5 MiB (multipart) hoặc một PutObject nếu stream ngắn hơn một part;
    // bộ nhớ giữ tối đa queueSize × partSize thay vì cả file.
    const upload = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 2,
      partSize: 5 * 1024 * 1024,
    });
    await upload.done();
  }

  presignDownload(key: string, filename: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    return getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
  }
}
