import type { RequestWithContext } from '../types/request-context';
import { readBearerToken } from './app-auth.guard';

function requestWithAuthorization(value: unknown): RequestWithContext {
  return { headers: { authorization: value } } as unknown as RequestWithContext;
}

describe('readBearerToken', () => {
  it('accepts space and tab separators and trims the token', () => {
    expect(readBearerToken(requestWithAuthorization('Bearer token-1'))).toBe('token-1');
    expect(readBearerToken(requestWithAuthorization('Bearer\ttoken-2'))).toBe('token-2');
    expect(readBearerToken(requestWithAuthorization('  BEARER   token-3  '))).toBe(
      'token-3',
    );
  });

  it('rejects missing, malformed and empty headers', () => {
    expect(readBearerToken(requestWithAuthorization(undefined))).toBeNull();
    expect(readBearerToken(requestWithAuthorization(['Bearer token']))).toBeNull();
    expect(readBearerToken(requestWithAuthorization('Bearer'))).toBeNull();
    expect(readBearerToken(requestWithAuthorization('Bearer '))).toBeNull();
    expect(readBearerToken(requestWithAuthorization('BearerX token'))).toBeNull();
    expect(readBearerToken(requestWithAuthorization('Basic token'))).toBeNull();
  });

  it('rejects long whitespace-only values without regex backtracking', () => {
    expect(
      readBearerToken(requestWithAuthorization(`Bearer${' '.repeat(200_000)}`)),
    ).toBeNull();
    expect(
      readBearerToken(requestWithAuthorization(`Bearer${'\t'.repeat(200_000)}`)),
    ).toBeNull();
  });
});
