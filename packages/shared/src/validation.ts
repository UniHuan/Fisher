/** Inclusive Shenzhen bounding box from PRD 10.4. */
export const SHENZHEN_BOUNDS = {
  minLatitude: 22.3,
  maxLatitude: 22.9,
  minLongitude: 113.7,
  maxLongitude: 114.7,
} as const;

/** PRD 6.x search keywords are clamped to 40 Unicode code points. */
export const MAX_KEYWORD_CODE_POINTS = 40;

export function isShenzhenCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SHENZHEN_BOUNDS.minLatitude &&
    lat <= SHENZHEN_BOUNDS.maxLatitude &&
    lng >= SHENZHEN_BOUNDS.minLongitude &&
    lng <= SHENZHEN_BOUNDS.maxLongitude
  );
}

/** Splits comma separated enums, trimming entries and dropping empty ones. */
export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Trims a search keyword, returns "" for empty input, and clamps non-empty
 * input to 40 Unicode code points. Rejecting empty keywords is a DTO concern.
 */
export function normalizeKeyword(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  return Array.from(trimmed).slice(0, MAX_KEYWORD_CODE_POINTS).join('');
}
