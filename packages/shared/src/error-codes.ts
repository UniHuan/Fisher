/**
 * Stable business error codes from PRD 10.4.
 * HTTP status carries the category, these codes carry the detail.
 */
export const ERROR_CODES = {
  SUCCESS: 0,
  VALIDATION: 40001,
  UNAUTHENTICATED: 40101,
  TOKEN_EXPIRED: 40102,
  FORBIDDEN: 40301,
  NOT_FOUND: 40401,
  STATE_CONFLICT: 40901,
  IDEMPOTENCY_CONFLICT: 40902,
  PAYLOAD_TOO_LARGE: 41301,
  PUBLISH_VALIDATION: 42201,
  RATE_LIMITED: 42901,
  INTERNAL: 50001,
  DEPENDENCY_UNAVAILABLE: 50301,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
