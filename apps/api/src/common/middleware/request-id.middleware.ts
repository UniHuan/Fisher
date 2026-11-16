import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { ulid } from 'ulid';
import type { RequestWithContext } from '../types/request-context';

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function createRequestId(): string {
  return `req_${ulid()}`;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const header = req.headers['x-request-id'];
    const requestId = isValidRequestId(header) ? header : createRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
