import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type AdminRole } from '@szfisher/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppError } from '../errors/app-error';
import type { RequestWithContext } from '../types/request-context';

/**
 * Runs after AdminAuthGuard and authorizes by the AdminContext it attaches.
 * Registered per controller rather than globally so only annotated routes opt in.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly AdminRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const admin = request.admin;
    if (admin === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    if (!requiredRoles.includes(admin.role)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, 'Insufficient permissions');
    }
    return true;
  }
}
