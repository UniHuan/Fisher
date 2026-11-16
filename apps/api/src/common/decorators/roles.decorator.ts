import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { AdminRole } from '@szfisher/shared';

export const ROLES_KEY = 'roles';

/** Restricts a handler to the listed admin roles; RolesGuard enforces the metadata. */
export const Roles = (...roles: AdminRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
