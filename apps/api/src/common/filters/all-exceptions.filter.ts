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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId = this.ensureRequestId(request, response);
    const { status, code, message, details } = this.describe(exception);
    response.status(status).json(fail(code, message, requestId, details));
  }

  private describe(exception: unknown): ErrorDescription {
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
        this.logUnexpected(exception);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL,
          message: INTERNAL_ERROR_MESSAGE,
        };
      }
      return { status, code, message: httpExceptionMessage(exception) };
    }

    this.logUnexpected(exception);
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
    response.setHeader('X-Request-Id', requestId);
    return requestId;
  }

  private logUnexpected(exception: unknown): void {
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
  }
}
