import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { StorageService } from '../storage/storage.service';

@ApiExcludeController()
@Controller('uploads')
export class UploadsPublicController {
  constructor(private readonly storage: StorageService) {}

  @Get('preview')
  async preview(
    @Query('key') key: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const expiresAt = expires === undefined ? NaN : Number(expires);
    if (
      key === undefined ||
      signature === undefined ||
      !Number.isInteger(expiresAt) ||
      !this.storage.verifyLocalPreview(key, expiresAt, signature)
    ) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Not found');
    }

    try {
      const body = await this.storage.readObject(key, 'working');
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'private, max-age=300');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.send(body);
    } catch {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Not found');
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
      response.send(body);
    } catch {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Not found');
    }
  }
}
