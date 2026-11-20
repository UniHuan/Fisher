import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AppAuthService } from '../../modules/app-auth/app-auth.service';
import { AppError } from '../errors/app-error';
import type { RequestWithContext } from '../types/request-context';
import { readBearerToken } from './app-auth.guard';

/**
 * Attaches the app user when a valid bearer token is present and otherwise lets
 * the request continue anonymously, for public endpoints with personalised fields.
 */
@Injectable()
export class OptionalAppAuthGuard implements CanActivate {
  constructor(private readonly auth: AppAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = readBearerToken(request);
    if (token === null) {
      return true;
    }
    try {
      request.appUser = await this.auth.authenticateAccess(token);
    } catch (error) {
      // Expired or invalid tokens degrade to anonymous; infrastructure errors still surface.
      if (error instanceof AppError && error.httpStatus === HttpStatus.UNAUTHORIZED) {
        return true;
      }
      throw error;
    }
    return true;
  }
}
