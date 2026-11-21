import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, PRODUCT_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import {
  ImageProcessorService,
  type UploadedImageFile,
} from '../uploads/image-processor.service';
import { PreviewSignerService } from '../uploads/preview-signer.service';
import type { ProductImageResponseDto } from './dto/product-image-response.dto';

const PRODUCT_IMAGE_PURPOSE = 'product';

/**
 * Product images live in the private work bucket while the product is a draft.
 * Activation copies each key to the published bucket so the public image route can
 * serve it; the public route itself never reads the work bucket.
 */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessorService,
    private readonly previewSigner: PreviewSignerService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async upload(
    productId: string,
    file: UploadedImageFile | undefined,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<ProductImageResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: { product_id: productId, deleted_at: null },
      select: { product_id: true, status: true },
    });
    if (product === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Product not found');
    }
    if (product.status === PRODUCT_STATUS.ARCHIVED) {
      throw new AppError(
        ERROR_CODES.STATE_CONFLICT,
        HttpStatus.CONFLICT,
        'Archived products cannot accept images',
      );
    }

    if (file === undefined || file.buffer === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Image file is required');
    }
    this.images.validateUpload(file.buffer, file.size);

    const processed = await this.images.process(file.buffer, PRODUCT_IMAGE_PURPOSE);
    const key = `products/${product.product_id}/${ulid()}.webp`;
    try {
      await this.storage.putObject(key, processed.data, 'image/webp');
    } catch {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Image storage unavailable',
      );
    }

    const preview = this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS);
    const result: ProductImageResponseDto = {
      key,
      preview_url: preview.url,
      expires_at: preview.expiresAt,
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
    };
    await this.recordAudit(admin, request, product.product_id, result);
    return result;
  }

  async publishForProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { product_id: productId },
      select: { product_id: true, image_keys: true },
    });
    if (product === null) {
      return;
    }

    await this.publishKeys(productId, product.image_keys);
  }

  /**
   * Copies the submitted key set to the published bucket. At least one copy must
   * succeed so a product never becomes active with image URLs that do not exist.
   */
  async publishKeys(productId: string, imageKeys: string[]): Promise<void> {
    let published = 0;
    for (const key of new Set(imageKeys)) {
      // Missing work-bucket objects are skipped so one stale key cannot block activation.
      // Any other storage failure propagates so activation fails loudly and can be retried.
      if (!(await this.storage.objectExists(key, 'working'))) {
        this.logger.warn(`product=${productId} skipped missing working image ${key}`);
        continue;
      }
      await this.storage.copyToPublished(key, key);
      published += 1;
    }
    if (published === 0) {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Image publishing failed',
      );
    }
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    productId: string,
    result: ProductImageResponseDto,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action: 'product.image_upload',
      entityType: 'product',
      entityId: productId,
      before: null,
      after: {
        key: result.key,
        width: result.width,
        height: result.height,
        size_bytes: result.size_bytes,
      },
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
