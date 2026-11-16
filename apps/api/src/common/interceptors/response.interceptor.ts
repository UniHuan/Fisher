import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ok, type ApiResponse } from '@szfisher/shared';
import { map, type Observable } from 'rxjs';
import type { RequestWithContext } from '../types/request-context';

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'number' &&
    typeof candidate.message === 'string' &&
    'data' in candidate &&
    typeof candidate.request_id === 'string'
  );
}

function isBinaryOrStream(value: unknown): boolean {
  if (value instanceof StreamableFile || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return true;
  }
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { pipe?: unknown }).pipe === 'function'
  );
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!request.path.startsWith('/api/v1')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        if (isApiResponse(data) || isBinaryOrStream(data)) {
          return data;
        }
        return ok(data === undefined ? null : data, request.requestId);
      }),
    );
  }
}
