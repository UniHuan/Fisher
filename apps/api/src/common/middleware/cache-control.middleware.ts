import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../types/request-context';

export const API_CACHE_CONTROL = 'no-store';

/**
 * Cache-Control default for the API: every /api/v1 response is non-cacheable unless a
 * controller deliberately overrides it. The public dictionaries and config controllers
 * do so after computing their payload, including on 304 responses.
 */
@Injectable()
export class CacheControlMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const rawPath = req.originalUrl ?? req.path ?? '';
    const path = (rawPath.split('?')[0] ?? '').toLowerCase();
    if (path === '/api/v1' || path.startsWith('/api/v1/')) {
      res.setHeader('Cache-Control', API_CACHE_CONTROL);
    }
    next();
  }
}
