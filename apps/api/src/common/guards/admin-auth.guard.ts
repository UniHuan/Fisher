import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@szfisher/shared';
import { AdminUsersRepository } from '../../modules/admin/admin-users.repository';
import { AdminAuthService } from '../../modules/auth/admin-auth.service';
import {
  ADMIN_LAST_ACTIVE_TOUCH_MS,
  ADMIN_SESSION_ABSOLUTE_MS,
  ADMIN_SESSION_IDLE_MS,
  AdminTokenService,
  isAdminRole,
} from '../../modules/auth/admin-token.service';
import { CsrfService } from '../../modules/auth/csrf.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';
import { ADMIN_ACCESS_COOKIE, readCookie } from '../http/admin-cookies';
import type { AdminContext, RequestWithContext } from '../types/request-context';

function isAdminPath(request: RequestWithContext): boolean {
  const url = request.originalUrl ?? request.path ?? '';
  const path = url.split('?')[0] ?? '';
  return path === '/api/v1/admin' || path.startsWith('/api/v1/admin/');
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
    private readonly tokens: AdminTokenService,
    private readonly csrf: CsrfService,
    private readonly users: AdminUsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    // Other modules own their own authentication; this guard only governs /api/v1/admin.
    if (!isAdminPath(request)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const accessToken = readCookie(request, ADMIN_ACCESS_COOKIE);
    if (accessToken === undefined) {
      throw this.unauthenticated();
    }
    const payload = this.tokens.verifyAccess(accessToken);
    if (payload === null) {
      throw this.unauthenticated();
    }

    const admin = await this.users.findById(payload.adminId);
    if (
      admin === null ||
      admin.status !== 'active' ||
      admin.token_version !== payload.tokenVersion ||
      !isAdminRole(admin.role)
    ) {
      throw this.unauthenticated();
    }

    const now = new Date();
    const sessionStartedAt = admin.session_started_at;
    const lastActiveAt = admin.last_active_at;
    if (
      sessionStartedAt === null ||
      lastActiveAt === null ||
      now.getTime() - sessionStartedAt.getTime() > ADMIN_SESSION_ABSOLUTE_MS ||
      now.getTime() - lastActiveAt.getTime() > ADMIN_SESSION_IDLE_MS
    ) {
      throw this.unauthenticated();
    }

    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      // Present disallowed origins are rejected; a missing Origin is allowed for
      // non-browser clients, but CSRF is still mandatory on every authenticated write.
      this.auth.assertAllowedOrigin(request, { required: false });
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfToken = typeof csrfHeader === 'string' ? csrfHeader : undefined;
      if (!this.csrf.verify(admin.admin_id, payload.jti, csrfToken)) {
        throw this.forbidden('Invalid CSRF token');
      }
    }

    const adminContext: AdminContext = {
      adminId: admin.admin_id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.token_version,
      jti: payload.jti,
    };
    request.admin = adminContext;

    if (now.getTime() - lastActiveAt.getTime() >= ADMIN_LAST_ACTIVE_TOUCH_MS) {
      await this.users.touchLastActive(admin.admin_id, now);
    }

    return true;
  }

  private unauthenticated(): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'Authentication required');
  }

  private forbidden(message: string): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, message);
  }
}
