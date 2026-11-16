import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ERROR_CODES, fail, type ValidationIssue } from '@szfisher/shared';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { createRequestId, isValidRequestId } from '../middleware/request-id.middleware';
import type { RequestWithContext } from '../types/request-context';

const HTTP_STATUS_TO_ERROR_CODE: Partial<Record<number, number>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.STATE_CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.PUBLISH_VALIDATION,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.DEPENDENCY_UNAVAILABLE,
};

// Safe messages for raw Express errors that must never leak their own message or stack.
const SAFE_STATUS_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad request',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.CONFLICT]: 'State conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload too large',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service unavailable',
};

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

interface ErrorDescription {
  status: number;
  code: number;
  message: string;
  details?: ValidationIssue[];
}

function asValidationIssues(details: unknown): ValidationIssue[] | undefined {
  if (!Array.isArray(details)) {
    return undefined;
  }
  const issues: ValidationIssue[] = [];
  for (const item of details) {
    if (typeof item !== 'object' || item === null) {
      return undefined;
    }
    const { field, message } = item as { field?: unknown; message?: unknown };
    if (typeof field !== 'string' || typeof message !== 'string') {
      return undefined;
    }
    issues.push({ field, message });
  }
  return issues;
}

function httpExceptionMessage(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === 'string') {
    return payload;
  }
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      const messages = message.filter((item): item is string => typeof item === 'string');
      if (messages.length > 0) {
        return messages.join('; ');
      }
    }
  }
  return exception.message;
}

function rawHttpStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const candidate = exception as { status?: unknown; statusCode?: unknown };
  for (const value of [candidate.statusCode, candidate.status]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId = this.ensureRequestId(request, response);

    if (response.headersSent) {
      this.logUnexpected(exception, request, requestId, 'response headers already sent');
      return;
    }

    const { status, code, message, details } = this.describe(exception, request, requestId);
    response.status(status).json(fail(code, message, requestId, details));
  }

  private describe(
    exception: unknown,
    request: RequestWithContext,
    requestId: string,
  ): ErrorDescription {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: asValidationIssues(exception.details),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_STATUS_TO_ERROR_CODE[status];
      if (code === undefined) {
        this.logUnexpected(exception, request, requestId);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL,
          message: INTERNAL_ERROR_MESSAGE,
        };
      }
      return { status, code, message: httpExceptionMessage(exception) };
    }

    const status = rawHttpStatus(exception);
    const code = status === undefined ? undefined : HTTP_STATUS_TO_ERROR_CODE[status];
    const message = status === undefined ? undefined : SAFE_STATUS_MESSAGES[status];
    if (status !== undefined && code !== undefined && message !== undefined) {
      return { status, code, message };
    }

    this.logUnexpected(exception, request, requestId);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private ensureRequestId(request: RequestWithContext, response: Response): string {
    if (isValidRequestId(request.requestId)) {
      return request.requestId;
    }
    const header = response.getHeader('X-Request-Id');
    if (isValidRequestId(header)) {
      request.requestId = header;
      return header;
    }
    const requestId = createRequestId();
    request.requestId = requestId;
    if (!response.headersSent) {
      response.setHeader('X-Request-Id', requestId);
    }
    return requestId;
  }

  private logUnexpected(
    exception: unknown,
    request: RequestWithContext,
    requestId: string,
    reason?: string,
  ): void {
    const method = typeof request?.method === 'string' ? request.method : 'UNKNOWN';
    const path = typeof request?.path === 'string' ? request.path : 'unknown';
    const detail =
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
    this.logger.error(
      `request_id=${requestId} method=${method} path=${path}${reason ? ` ${reason}` : ''}: ${detail}`,
    );
  }
}
