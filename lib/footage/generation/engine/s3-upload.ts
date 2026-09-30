// s3-upload.ts: puts a local file where a provider can fetch it, for APIs that only take HTTPS URLs (OpenRouter's
// reference videos). An S3-compatible bucket, R2 or S3, reached with presigned URLs alone: one SigV4 signer covers
// the upload, the check for an earlier one, and the link handed to the provider, so no SDK is needed.
//
// Objects are named by their bytes, so a file already uploaded is only signed again, never re-sent. The bucket
// expires them after a day; the links expire sooner.
import { createHash, createHmac } from 'node:crypto';

export type S3UploadConfig = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };

const UPLOAD_ENV = {
  endpoint: 'STUDIO_UPLOAD_S3_ENDPOINT',
  bucket: 'STUDIO_UPLOAD_S3_BUCKET',
  accessKeyId: 'STUDIO_UPLOAD_S3_ACCESS_KEY_ID',
  secretAccessKey: 'STUDIO_UPLOAD_S3_SECRET_ACCESS_KEY',
} as const;
// Optional: R2 signs with region "auto", and an AWS bucket needs its own.
const UPLOAD_REGION_ENV = 'STUDIO_UPLOAD_S3_REGION';
// Long enough for a provider to fetch a reference when a queued job starts, short enough that a leaked link is stale.
const LINK_SECONDS = 60 * 60;
// Presigned uploads and checks are used at once.
const REQUEST_SECONDS = 5 * 60;

function s3UploadConfigFromEnv(): S3UploadConfig {
  const missing = Object.values(UPLOAD_ENV).filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set: a reference video is uploaded to our bucket for the provider to fetch. `
      + 'Run under your secret launcher, e.g. `"$(studio home)/bin/studio-secrets" studio <verb> <project>`');
  }
  const env = Object.fromEntries(Object.entries(UPLOAD_ENV).map(([key, name]) => [key, process.env[name]!])) as Omit<S3UploadConfig, 'region'>;
  return { ...env, endpoint: env.endpoint.replace(/\/+$/, ''), region: process.env[UPLOAD_REGION_ENV] || 'auto' };
}

/**
 * Uploads `bytes` to the bucket the environment names, as references/<sha256>.<ext> unless it's already there, and
 * returns a link to it that expires.
 */
export async function uploadS3Reference(bytes: Buffer, { sha256, ext, mime }: { sha256: string; ext: string; mime: string }): Promise<string> {
  const config = s3UploadConfigFromEnv();
  const url = `${config.endpoint}/${config.bucket}/references/${sha256}.${ext}`;
  const now = new Date();
  const head = await fetch(presignS3Url(config, 'HEAD', url, now, REQUEST_SECONDS), { method: 'HEAD' });
  // S3 answers 403, not 404, for a missing object when the key can't list the bucket. Either way the upload goes
  // ahead, and a key that can't write says so there.
  if (head.status === 404 || head.status === 403) {
    const put = await fetch(presignS3Url(config, 'PUT', url, now, REQUEST_SECONDS), { method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Type': mime } });
    if (!put.ok) throw new Error(`upload to ${config.bucket} ${put.status}: ${await put.text()}`);
    console.error(`uploaded references/${sha256}.${ext} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  } else if (!head.ok) {
    throw new Error(`checking ${config.bucket} for references/${sha256}.${ext}: ${head.status}`);
  }
  return presignS3Url(config, 'GET', url, now, LINK_SECONDS);
}

// RFC 3986 unreserved characters stay; everything else is percent-encoded, as SigV4 requires.
const encodeSigV4 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * A SigV4 query-signed URL for `method` on `url`, valid `seconds` from `now`. Only the host header is signed and the
 * payload isn't, so the same URL shape serves GET, HEAD and PUT.
 */
export function presignS3Url(config: Omit<S3UploadConfig, 'endpoint' | 'bucket'>, method: string, url: string, now: Date, seconds: number): string {
  const { host, pathname } = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const query = Object.entries({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(seconds),
    'X-Amz-SignedHeaders': 'host',
  }).map(([k, v]) => `${encodeSigV4(k)}=${encodeSigV4(v)}`).toSorted().join('&');
  const path = pathname.split('/').map((segment) => encodeSigV4(decodeURIComponent(segment))).join('/');
  const canonical = [method, path, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const key = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region));
  return `${new URL(url).origin}${path}?${query}&X-Amz-Signature=${createHmac('sha256', key).update(toSign).digest('hex')}`;
}
