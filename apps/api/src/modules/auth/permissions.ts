import { ADMIN_ROLE, type AdminRole } from '@szfisher/shared';

/**
 * Stable permission names. Plan B consumes these strings, so they must not be renamed.
 * Enforcement happens on the server; clients only use the names to shape the UI.
 */
export const PERMISSIONS: Record<AdminRole, readonly string[]> = {
  [ADMIN_ROLE.SUPER_ADMIN]: [
    'spot:read',
    'spot:write',
    'spot:publish',
    'spot:delete',
    'import:write',
    'poi:read',
    'poi:write',
    'audit:read',
    'audit:read:self',
    'audit:export',
    'dictionary:write',
    'config:write',
    'admin:manage',
  ],
  [ADMIN_ROLE.OPERATOR]: [
    'spot:read',
    'spot:write',
    'spot:publish',
    'import:write',
    'poi:write',
    'audit:read:self',
  ],
  [ADMIN_ROLE.REVIEWER]: ['spot:read', 'poi:read', 'audit:read'],
};

export function permissionsForRole(role: AdminRole): readonly string[] {
  return PERMISSIONS[role];
}
