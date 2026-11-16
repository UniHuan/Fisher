/** Uppercase Crockford Base32, excluding I, L, O and U. First char fits 128 bits. */
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
