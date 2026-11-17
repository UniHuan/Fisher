import { Injectable } from '@nestjs/common';
import { CLIENT_TYPE, type ClientType } from '@szfisher/shared';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

export const SERVER_ANALYTICS_EVENTS = new Set([
  'api_spot_list',
  'api_spot_detail',
  'api_search',
  'api_error',
  'api_rate_limited',
]);

const ALLOWED_PROPERTIES = new Set([
  'result_count',
  'has_location',
  'sort',
  'spot_id',
  'open_status',
  'latency_ms',
  'route',
  'error_code',
  'status',
]);

const CLIENT_TYPES = new Set<string>(Object.values(CLIENT_TYPE));

export interface AnalyticsRecordInput {
  eventName: string;
  clientType?: string;
  appVersion?: string | null;
  requestId?: string | null;
  properties?: Record<string, unknown>;
}

function safeProperty(value: unknown): string | number | boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 200);
  }
  return null;
}

/**
 * Fire-and-forget server analytics writer. Failures must never affect the API
 * response, and only whitelisted, non-PII properties are persisted.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AnalyticsRecordInput): Promise<void> {
    if (!SERVER_ANALYTICS_EVENTS.has(input.eventName)) {
      return;
    }
    const clientType =
      input.clientType !== undefined && CLIENT_TYPES.has(input.clientType)
        ? input.clientType
        : CLIENT_TYPE.MINIPROGRAM;
    const properties: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input.properties ?? {})) {
      if (!ALLOWED_PROPERTIES.has(key)) {
        continue;
      }
      const safe = safeProperty(value);
      if (safe !== null) {
        properties[key] = safe;
      }
    }
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          event_id: ulid(),
          event_name: input.eventName,
          client_type: clientType as ClientType,
          app_version:
            input.appVersion === undefined || input.appVersion === null
              ? null
              : input.appVersion.slice(0, 32),
          request_id:
            input.requestId === undefined || input.requestId === null
              ? null
              : input.requestId.slice(0, 64),
          properties,
          occurred_at: new Date(),
        },
      });
    } catch {
      // Analytics is best-effort; never fail the public request because of it.
    }
  }

  async purgeExpired(days = 180): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    const result = await this.prisma.analyticsEvent.deleteMany({
      where: { occurred_at: { lt: cutoff } },
    });
    return result.count;
  }
}
