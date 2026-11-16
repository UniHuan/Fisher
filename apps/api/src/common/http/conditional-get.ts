import { HttpStatus } from '@nestjs/common';
import { ok } from '@szfisher/shared';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import type { RequestWithContext } from '../types/request-context';

export const PUBLIC_CACHE_CONTROL = 'public, max-age=600';

/** Strong ETag: first 16 bytes of SHA-256 over the stable payload, quoted. */
export function strongEtag(payload: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  return `"${digest.slice(0, 32)}"`;
}

export function etagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const headerValues = Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch];
  for (const header of headerValues) {
    for (const candidate of header.split(',')) {
      // Weak comparison for cache validation; our tag itself is strong.
      const normalized = candidate.trim().replace(/^W\//, '');
      if (normalized === '*' || normalized === etag) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Writes a cacheable public JSON envelope with ETag / Cache-Control and handles
 * If-None-Match with a bodyless 304. The ETag covers only the stable payload,
 * never the envelope or request_id.
 */
export function sendConditionalJson<T>(
  request: RequestWithContext,
  response: Response,
  payload: T,
): void {
  const etag = strongEtag(payload);
  response.setHeader('ETag', etag);
  response.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);

  if (etagMatches(request.headers['if-none-match'], etag)) {
    response.status(HttpStatus.NOT_MODIFIED).end();
    return;
  }

  response.status(HttpStatus.OK).json(ok(payload, request.requestId));
}
