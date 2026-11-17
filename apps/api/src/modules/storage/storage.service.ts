import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { LocalStorageAdapter } from './local-storage.adapter';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
  type StorageArea,
} from './storage.types';

export const PREVIEW_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter) {}

  putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.adapter.putObject(key, body, contentType);
  }

  getPreviewUrl(key: string): Promise<string> {
    return this.adapter.getSignedUrl(key, PREVIEW_URL_TTL_SECONDS);
  }

  getImageUrl(key: string, published: boolean): Promise<string> {
    return published ? Promise.resolve(this.adapter.getPublicUrl(key)) : this.getPreviewUrl(key);
  }

  async publishImages(keys: string[]): Promise<void> {
    try {
      for (const key of new Set(keys)) {
        await this.adapter.copyObject(key, key);
      }
    } catch {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Image publishing failed',
      );
    }
  }

  readObject(key: string, area: StorageArea): Promise<Buffer> {
    return this.adapter.getObject(key, area);
  }

  verifyLocalPreview(key: string, expires: number, signature: string): boolean {
    return (
      this.adapter instanceof LocalStorageAdapter &&
      this.adapter.verifySignedUrl(key, expires, signature)
    );
  }
}
