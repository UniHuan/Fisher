import { createHmac } from 'node:crypto';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter, StorageArea } from './storage.types';

const STORAGE_KEY_PATTERN =
  /^(spots\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp|ugc\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp|feedback\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp|products\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp|imports\/[A-Za-z0-9]{26}\/[A-Za-z0-9-]+\.(xlsx|csv))$/;

function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new Error('Invalid storage key');
  }
}

/**
 * Local development/test storage. The working and published areas are separate
 * directories and the public URL is served by the API until CDN is configured.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;
  private readonly signingSecret: string;

  constructor(root: string, signingSecret: string) {
    this.root = path.resolve(root);
    this.signingSecret = `${signingSecret}:storage-preview`;
  }

  async putObject(key: string, body: Buffer, _contentType: string): Promise<void> {
    void _contentType;
    const target = this.resolve('working', key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    const source = this.resolve('working', sourceKey);
    const dest = this.resolve('published', destKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await unlink(this.resolve('working', key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async deletePublishedObject(key: string): Promise<void> {
    try {
      await unlink(this.resolve('published', key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async getSignedUrl(key: string, expiresSeconds: number): Promise<string> {
    assertStorageKey(key);
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresSeconds));
    const signature = this.sign(key, expires);
    const query = new URLSearchParams({
      key,
      expires: String(expires),
      signature,
    });
    return `/api/v1/uploads/preview?${query.toString()}`;
  }

  getPublicUrl(key: string): string {
    assertStorageKey(key);
    return `/api/v1/uploads/public/${key}`;
  }

  async getObject(key: string, area: StorageArea): Promise<Buffer> {
    return readFile(this.resolve(area, key));
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expires}`)
      .digest('base64url');
  }

  private resolve(area: StorageArea, key: string): string {
    assertStorageKey(key);
    const target = path.resolve(this.root, area, key);
    const areaRoot = path.resolve(this.root, area);
    if (!target.startsWith(`${areaRoot}${path.sep}`)) {
      throw new Error('Invalid storage key');
    }
    return target;
  }
}
