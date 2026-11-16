import { ERROR_CODES } from './error-codes';

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Unified API envelope from PRD 10.4. `data` is null for failures. */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
  request_id: string;
  details?: ValidationIssue[];
}

/** Unified pagination shape from PRD 10.4. */
export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export function ok<T>(data: T, requestId: string): ApiResponse<T> {
  return {
    code: ERROR_CODES.SUCCESS,
    message: 'ok',
    data,
    request_id: requestId,
  };
}

export function fail(
  code: number,
  message: string,
  requestId: string,
  details?: ValidationIssue[],
): ApiResponse<null> {
  return {
    code,
    message,
    data: null,
    request_id: requestId,
    ...(details === undefined ? {} : { details }),
  };
}
