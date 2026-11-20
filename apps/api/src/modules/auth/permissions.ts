import { ADMIN_ROLE, type AdminRole } from '@szfisher/shared';

/**
 * Stable permission names. Plan B consumes these strings, so they must not be renamed.
 * Enforcement happens on the server; clients only use the names to shape the UI.
 *
 * `spot:write` covers the P0 mark-verified action because V1.0 has no separate
 * `spot:verify` permission. Clients must gate the verify button on `spot:write`.
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
    'report:read',
    'report:moderate',
    'feedback:read',
    'feedback:handle',
    'user:restrict',
    'user:ban',
    'dictionary:write',
    'config:write',
    'admin:manage',
  ],
  [ADMIN_ROLE.OPERATOR]: [
    'spot:read',
    'spot:write',
    'spot:publish',
    'import:write',
    'poi:read',
    'poi:write',
    'audit:read:self',
    'report:read',
    'report:moderate',
    'feedback:read',
    'feedback:handle',
    'user:restrict',
    'user:ban',
  ],
  [ADMIN_ROLE.REVIEWER]: [
    'spot:read',
    'poi:read',
    'report:read',
    'report:moderate',
    'feedback:read',
    'feedback:handle',
  ],
};

export function permissionsForRole(role: AdminRole): readonly string[] {
  return PERMISSIONS[role];
}
