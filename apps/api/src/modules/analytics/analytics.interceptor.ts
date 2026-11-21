import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { RequestWithContext } from '../../common/types/request-context';
import { AnalyticsService } from './analytics.service';

interface ListPayload {
  total?: number;
}

interface ProductListPayload {
  items?: unknown[];
}

interface DetailPayload {
  spot_id?: string;
  open_status?: string | null;
}

@Injectable()
export class AnalyticsInterceptor implements NestInterceptor {
  constructor(private readonly analytics: AnalyticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const path = request.path;
    const isSpotList = path === '/api/v1/spots';
    const isProductList = path === '/api/v1/products';
    const detailMatch =
      path.startsWith('/api/v1/spots/') &&
      path !== '/api/v1/spots/map' &&
      !path.slice('/api/v1/spots/'.length).includes('/');
    if (!isSpotList && !isProductList && !detailMatch) {
      return next.handle();
    }
    const startedAt = Date.now();
    return next.handle().pipe(
      tap((payload: unknown) => {
        if (typeof payload !== 'object' || payload === null) {
          return;
        }
        const query = request.query as Record<string, unknown>;
        const hasLocation =
          typeof query.latitude === 'string' && query.latitude.length > 0;
        const latency = Date.now() - startedAt;
        if (isProductList) {
          const result = payload as ProductListPayload;
          void this.analytics.record({
            eventName: 'api_product_list',
            clientType: request.clientType,
            appVersion: request.clientVersion,
            requestId: request.requestId,
            properties: {
              surface: typeof query.surface === 'string' ? query.surface : '',
              spot_id: typeof query.target_id === 'string' ? query.target_id : '',
              result_count: Array.isArray(result.items) ? result.items.length : 0,
              latency_ms: latency,
            },
          });
          return;
        }
        if (isSpotList) {
          const result = payload as ListPayload;
          const isSearch =
            typeof query.keyword === 'string' && query.keyword.length > 0;
          void this.analytics.record({
            eventName: isSearch ? 'api_search' : 'api_spot_list',
            clientType: request.clientType,
            appVersion: request.clientVersion,
            requestId: request.requestId,
            properties: {
              result_count: typeof result.total === 'number' ? result.total : 0,
              has_location: hasLocation,
              sort: typeof query.sort === 'string' ? query.sort : 'recommended',
              latency_ms: latency,
            },
          });
          return;
        }
        const detail = payload as DetailPayload;
        void this.analytics.record({
          eventName: 'api_spot_detail',
          clientType: request.clientType,
          appVersion: request.clientVersion,
          requestId: request.requestId,
          properties: {
            spot_id: detail.spot_id ?? '',
            open_status: detail.open_status ?? '',
            latency_ms: latency,
          },
        });
      }),
    );
  }
}
