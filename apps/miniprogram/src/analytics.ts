const SESSION_ID = `wx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function platform(): string {
  try {
    const value = wx.getSystemInfoSync().platform ?? 'devtools';
    return value.toLowerCase();
  } catch {
    return 'devtools';
  }
}

function appVersion(): string {
  try {
    return wx.getAccountInfoSync().miniProgram?.version || 'dev';
  } catch {
    return 'dev';
  }
}

function pagePath(): string {
  try {
    const pages = getCurrentPages();
    return pages.length === 0 ? '' : (pages[pages.length - 1]?.route ?? '');
  } catch {
    return '';
  }
}

function propertyValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  return undefined;
}

/**
 * WeChat custom-analysis wrapper. Reporting must never break the browse flow;
 * unknown property values are dropped instead of being serialized as objects.
 */
export function track(eventName: string, properties: Record<string, unknown> = {}): void {
  const payload: Record<string, string | number> = {
    client_type: 'miniprogram',
    platform: platform(),
    app_version: appVersion(),
    page_path: pagePath(),
    session_id: SESSION_ID,
  };
  for (const [key, value] of Object.entries(properties)) {
    const normalized = propertyValue(value);
    if (normalized !== undefined) {
      payload[key] = normalized;
    }
  }
  try {
    wx.reportAnalytics(eventName, payload);
  } catch {
    // Never let analytics block a page.
  }
}
