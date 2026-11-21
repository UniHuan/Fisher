import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import sharp from 'sharp';
import { AppError } from '../../common/errors/app-error';
import type { UploadPurpose } from './dto/upload-image.dto';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImagePurpose = UploadPurpose | 'ugc' | 'product';

const TARGET_BYTES: Record<ImagePurpose, number> = {
  cover: 200 * 1024,
  detail: 300 * 1024,
  ugc: 300 * 1024,
  product: 250 * 1024,
};
const MAX_DIMENSION = 1600;
const QUALITIES = [82, 75, 68, 60] as const;

export interface UploadedImageFile {
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
  originalname?: string;
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

type SupportedImage = 'jpeg' | 'png' | 'webp';

/** Sniffs magic bytes so a renamed SVG, GIF or PDF is never accepted. */
export function detectImageType(buffer: Buffer): SupportedImage | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Validates and re-encodes uploaded images: magic-byte allow list, 10 MB cap,
 * auto-rotate, 1600 px longest edge, WebP output. EXIF/GPS are dropped because
 * sharp only keeps metadata when `withMetadata()` is requested.
 */
@Injectable()
export class ImageProcessorService {
  validateUpload(buffer: Buffer, size?: number): void {
    const originalSize = size ?? buffer.length;
    if (originalSize > MAX_UPLOAD_BYTES || buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Image exceeds 10 MB',
      );
    }
    if (detectImageType(buffer) === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Only JPG, PNG and WebP images are accepted',
      );
    }
  }

  async process(buffer: Buffer, purpose: ImagePurpose): Promise<ProcessedImage> {
    const target = TARGET_BYTES[purpose];
    try {
      for (const quality of QUALITIES) {
        const result = await sharp(buffer, {
          failOn: 'error',
          limitInputPixels: 40_000_000,
        })
          .rotate()
          .resize({
            width: MAX_DIMENSION,
            height: MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality })
          .toBuffer({ resolveWithObject: true });
        if (result.data.length <= target) {
          return {
            data: result.data,
            width: result.info.width,
            height: result.info.height,
          };
        }
      }
    } catch {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Image could not be processed',
      );
    }
    throw new AppError(
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'Image is still too large after compression',
    );
  }
}
