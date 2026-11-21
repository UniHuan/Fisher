import { Controller, Get, HttpStatus, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  ERROR_CODES,
  MODERATION_STATUS,
  OPEN_STATUS,
  PRODUCT_STATUS,
  SPOT_STATUS,
} from '@szfisher/shared';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import type { StorageArea } from '../storage/storage.types';
import { PreviewSignerService } from './preview-signer.service';

const ULID_PATTERN = /^[A-Za-z0-9]{26}$/;
const IMAGE_FILE_PATTERN = /^[A-Za-z0-9]{26}\.webp$/;
const PUBLIC_REPORT_STATUSES = [
  MODERATION_STATUS.PUBLISHED,
  MODERATION_STATUS.HUMAN_APPROVED,
] as const;

function notFound(): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Not found');
}

@ApiExcludeController()
@Controller('uploads')
export class UploadsPublicController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly clientConfig: ClientConfigService,
    private readonly previewSigner: PreviewSignerService,
  ) {}

  @Get('preview')
  async preview(
    @Query('key') key: string | undefined,
    @Query('area') area: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const expiresAt = expires === undefined ? NaN : Number(expires);
    const previewArea: StorageArea = area === 'published' ? 'published' : 'working';
    if (
      key === undefined ||
      signature === undefined ||
      !Number.isInteger(expiresAt) ||
      !this.previewSigner.verify(key, previewArea, expiresAt, signature)
    ) {
      throw notFound();
    }

    try {
      const body = await this.storage.readObject(key, previewArea);
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'private, max-age=300');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.send(body);
    } catch {
      throw notFound();
    }
  }

  @Get('public/spots/:spotId/:file')
  async publicImage(
    @Param('spotId') spotId: string,
    @Param('file') file: string,
    @Res() response: Response,
  ): Promise<void> {
    const key = `spots/${spotId}/${file}`;
    try {
      const body = await this.storage.readObject(key, 'published');
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.send(body);
    } catch {
      throw notFound();
    }
  }

  @Get('public/products/:productId/:file')
  async publicProductImage(
    @Param('productId') productId: string,
    @Param('file') file: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!ULID_PATTERN.test(productId) || !IMAGE_FILE_PATTERN.test(file)) {
      throw notFound();
    }
    const key = `products/${productId}/${file}`;
    const product = await this.prisma.product.findFirst({
      where: {
        product_id: productId,
        status: PRODUCT_STATUS.ACTIVE,
        deleted_at: null,
        image_keys: { has: key },
      },
      select: { product_id: true },
    });
    if (product === null) {
      throw notFound();
    }

    try {
      const body = await this.storage.readObject(key, 'published');
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.send(body);
    } catch {
      throw notFound();
    }
  }

  @Get('public/ugc/:reportId/:file')
  async publicUgcImage(
    @Param('reportId') reportId: string,
    @Param('file') file: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!ULID_PATTERN.test(reportId) || !IMAGE_FILE_PATTERN.test(file)) {
      throw notFound();
    }
    const config = await this.clientConfig.getClientConfig();
    if (!config.features.ugc) {
      throw notFound();
    }

    const report = await this.prisma.report.findFirst({
      where: {
        report_id: reportId,
        deleted_at: null,
        moderation_status: { in: [...PUBLIC_REPORT_STATUSES] },
        spot: {
          is: {
            status: SPOT_STATUS.PUBLISHED,
            deleted_at: null,
            OR: [{ open_status: null }, { open_status: { not: OPEN_STATUS.BANNED } }],
          },
        },
      },
      select: { report_id: true, images: true },
    });
    if (report === null) {
      throw notFound();
    }
    const basenames = new Set(report.images.map((key) => key.split('/').pop() ?? ''));
    if (!basenames.has(file)) {
      throw notFound();
    }

    try {
      const body = await this.storage.readObject(`ugc/${reportId}/${file}`, 'published');
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'public, max-age=86400');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.send(body);
    } catch {
      throw notFound();
    }
  }
}
