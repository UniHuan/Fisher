import OSS from 'ali-oss';
import type { StorageAdapter, StorageArea } from './storage.types';

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
    await this.publicClient.copy(destKey, `${this.workBucket}/${sourceKey}`);
  }

  async deleteObject(key: string): Promise<void> {
    await this.workClient.delete(key);
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
}
