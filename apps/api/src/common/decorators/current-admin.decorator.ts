import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminContext, RequestWithContext } from '../types/request-context';

/** Injects the AdminContext that AdminAuthGuard attached to the request. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminContext | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    return request.admin;
  },
);
