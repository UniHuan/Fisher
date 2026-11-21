import OSS from 'ali-oss';
import type { StorageAdapter, StorageArea } from './storage.types';

/**
 * ali-oss reports a missing object as NoSuchKey. A bare 404 is not enough:
 * NoSuchBucket, permission-masked 404s and proxy errors also use that status.
 */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === 'NoSuchKey' || candidate.name === 'NoSuchKey';
}

export interface OssStorageOptions {
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  workBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
}

/**
 * Aliyun OSS adapter. The work bucket stays private; published objects are copied
 * to the CDN-backed public bucket. Credentials never leave the API process.
 */
export class OssStorageAdapter implements StorageAdapter {
  private readonly workClient: OSS;
  private readonly publicClient: OSS;
  private readonly publicBaseUrl: string;
  private readonly workBucket: string;

  constructor(options: OssStorageOptions) {
    const common = {
      region: options.region,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
    };
    this.workClient = new OSS({ ...common, bucket: options.workBucket });
    this.publicClient = new OSS({ ...common, bucket: options.publicBucket });
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
    this.workBucket = options.workBucket;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.workClient.put(key, body, { mime: contentType });
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    // ali-oss treats the third argument as the source bucket; without it the
    // source is resolved inside the destination bucket and returns NoSuchKey.
    await this.publicClient.copy(destKey, sourceKey, this.workBucket);
  }

  async deleteObject(key: string): Promise<void> {
    await this.workClient.delete(key);
  }

  async deletePublishedObject(key: string): Promise<void> {
    await this.publicClient.delete(key);
  }

  async getSignedUrl(key: string, expiresSeconds: number): Promise<string> {
    return this.workClient.signatureUrl(key, {
      expires: Math.max(1, Math.floor(expiresSeconds)),
    });
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async getObject(key: string, area: StorageArea): Promise<Buffer> {
    const client = area === 'working' ? this.workClient : this.publicClient;
    const result = await client.get(key);
    return result.content;
  }

  async objectExists(key: string, area: StorageArea): Promise<boolean> {
    const client = area === 'working' ? this.workClient : this.publicClient;
    try {
      await client.head(key);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }
}
