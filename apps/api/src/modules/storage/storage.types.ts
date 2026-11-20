export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export type StorageArea = 'working' | 'published';

export interface StorageAdapter {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  copyObject(sourceKey: string, destKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  deletePublishedObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresSeconds: number): Promise<string>;
  getPublicUrl(key: string): string;
  getObject(key: string, area: StorageArea): Promise<Buffer>;
}
