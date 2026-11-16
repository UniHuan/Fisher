import type { CookieOptions, Request, Response } from 'express';

export const ADMIN_ACCESS_COOKIE = '__Host-fish_access';
export const ADMIN_REFRESH_COOKIE = '__Host-fish_refresh';
export const ADMIN_ACCESS_TTL_SECONDS = 30 * 60;
export const ADMIN_REFRESH_TTL_SECONDS = 8 * 60 * 60;

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export interface AuthCookieValues {
  accessToken: string;
  refreshToken: string;
}

/** Writes host-only `__Host-` cookies. Tokens never reach the response body. */
export function setAuthCookies(response: Response, tokens: AuthCookieValues): void {
  response.cookie(ADMIN_ACCESS_COOKIE, tokens.accessToken, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: ADMIN_ACCESS_TTL_SECONDS * 1000,
  });
  response.cookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: ADMIN_REFRESH_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ADMIN_ACCESS_COOKIE, BASE_COOKIE_OPTIONS);
  response.clearCookie(ADMIN_REFRESH_COOKIE, BASE_COOKIE_OPTIONS);
}

export function readCookie(request: Request, name: string): string | undefined {
  const value: unknown = request.cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
