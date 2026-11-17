import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../types/request-context';

const SKIPPED_PATHS = new Set(['/health', '/ready']);

/**
 * Structured HTTP access log for SLS/CloudMonitor. Never log query strings:
 * signed upload preview URLs and future tokens must not reach log storage.
 */
export function accessLogMiddleware(
  req: RequestWithContext,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.NODE_ENV === 'test' || SKIPPED_PATHS.has(req.path)) {
    next();
    return;
  }
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : 'info',
        type: 'http_access',
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        ...(req.clientType === undefined ? {} : { client_type: req.clientType }),
      })}\n`,
    );
  });
  next();
}
