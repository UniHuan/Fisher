import { isUlid } from '@szfisher/shared';

const MAX_CURSOR_LENGTH = 256;

export interface ReportCursor {
  createdAt: Date;
  reportId: string;
}

/** Public list cursors are base64 of `created_at|report_id`. */
export function encodeReportCursor(createdAt: Date, reportId: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${reportId}`, 'utf8').toString('base64');
}

/** Returns null for malformed cursors so the service can answer 400. */
export function decodeReportCursor(cursor: string): ReportCursor | null {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    return null;
  }
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = raw.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  const age = raw.slice(0, separator);
  const reportId = raw.slice(separator + 1);
  if (!isUlid(reportId)) {
    return null;
  }
  const createdAt = new Date(age);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== age) {
    return null;
  }
  return { createdAt, reportId };
}
