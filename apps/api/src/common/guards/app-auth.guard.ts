import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import { AppAuthService } from '../../modules/app-auth/app-auth.service';
import { AppError } from '../errors/app-error';
import type { RequestWithContext } from '../types/request-context';

/** Reads an `Authorization: Bearer <token>` header, or null when absent. */
export function readBearerToken(request: RequestWithContext): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(private readonly auth: AppAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = readBearerToken(request);
    if (token === null) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    request.appUser = await this.auth.authenticateAccess(token);
    return true;
  }
}
