import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppUserContext, RequestWithContext } from '../types/request-context';

/** Injects the AppUserContext that AppAuthGuard attached to the request. */
export const CurrentAppUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AppUserContext | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    return request.appUser;
  },
);
