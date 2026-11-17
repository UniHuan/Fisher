import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import { CLIENT_TYPE, ERROR_CODES, type ClientType } from '@szfisher/shared';
import type { NextFunction, Response } from 'express';
import { AppError } from '../errors/app-error';
import type { RequestWithContext } from '../types/request-context';

const CLIENT_TYPES: readonly string[] = Object.values(CLIENT_TYPE);
const PUBLIC_PATHS = new Set(['/health', '/ready']);
const PUBLIC_ASSET_PREFIXES = ['/api/v1/uploads/preview', '/api/v1/uploads/public/'];

function isClientType(value: unknown): value is ClientType {
  return typeof value === 'string' && CLIENT_TYPES.includes(value);
}

@Injectable()
export class ClientContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, _res: Response, next: NextFunction): void {
    if (
      PUBLIC_PATHS.has(req.path) ||
      PUBLIC_ASSET_PREFIXES.some((prefix) => req.path.startsWith(prefix))
    ) {
      next();
      return;
    }

    const clientType = req.headers['x-client-type'];
    if (!isClientType(clientType)) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Invalid or missing X-Client-Type header',
      );
    }

    const clientVersion = req.headers['x-client-version'];
    if (typeof clientVersion !== 'string' || clientVersion.trim() === '') {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Invalid or missing X-Client-Version header',
      );
    }

    req.clientType = clientType;
    req.clientVersion = clientVersion;
    next();
  }
}
