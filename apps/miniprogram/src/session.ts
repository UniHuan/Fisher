import {
  getMe as fetchMe,
  loginWithWechat,
  logout as apiLogout,
  moderationStatusLabel,
  refreshSession as refreshTokens,
  restrictionDateText,
  type AppMe,
  type AppNotice,
  type AppSession,
} from './api';

const SESSION_KEY = 'szfisher.session';
const NOTICE_KEY = 'szfisher.notices';
const RESTRICTION_KEY = 'szfisher.restriction-notice';

let loginPromise: Promise<AppSession> | null = null;
let refreshPromise: Promise<AppSession> | null = null;
let logoutPromise: Promise<void> | null = null;
let loggingOut = false;
// Incremented by every clear. A refresh that started under an older epoch must
// never write its result back: logout has to stay final.
let sessionEpoch = 0;

function readStorage<T>(key: string): T | null {
  try {
    const raw = wx.getStorageSync(key);
    if (typeof raw === 'string') {
      if (raw.length === 0) {
        return null;
      }
      return JSON.parse(raw) as T;
    }
    if (raw !== null && typeof raw === 'object') {
      return raw as T;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch {
    // Storage failures must not break the session flow.
  }
}

export function getSession(): AppSession | null {
  const stored = readStorage<Partial<AppSession>>(SESSION_KEY);
  if (
    stored === null ||
    typeof stored.access_token !== 'string' ||
    stored.access_token.length === 0 ||
    typeof stored.refresh_token !== 'string' ||
    stored.refresh_token.length === 0
  ) {
    return null;
  }
  return {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    token_type: stored.token_type ?? 'Bearer',
    expires_in: stored.expires_in ?? 0,
    user: stored.user ?? { nickname: null, avatar_url: null },
  };
}

export function getAccessToken(): string | null {
  return getSession()?.access_token ?? null;
}

export function getRefreshToken(): string | null {
  return getSession()?.refresh_token ?? null;
}

export function clearSession(): void {
  sessionEpoch += 1;
  try {
    wx.removeStorageSync(SESSION_KEY);
  } catch {
    // Ignore storage errors while clearing a dead session.
  }
}

function loginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.login({
      success: (result) => {
        if (typeof result.code === 'string' && result.code.length > 0) {
          resolve(result.code);
          return;
        }
        reject(new Error('微信登录失败'));
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '微信登录失败'));
      },
    });
  });
}

async function loginWithCode(): Promise<AppSession> {
  const code = await loginCode();
  const session = await loginWithWechat(code);
  writeStorage(SESSION_KEY, session);
  return session;
}

export function ensureSession(): Promise<AppSession> {
  const existing = getSession();
  if (existing !== null) {
    return Promise.resolve(existing);
  }
  if (loginPromise !== null) {
    return loginPromise;
  }
  loginPromise = loginWithCode().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

export function refreshSession(): Promise<AppSession> {
  if (loggingOut) {
    return Promise.reject(new Error('已退出登录'));
  }
  if (refreshPromise !== null) {
    return refreshPromise;
  }
  const current = getSession();
  if (current === null) {
    return Promise.reject(new Error('未登录'));
  }
  const epoch = sessionEpoch;
  refreshPromise = refreshTokens(current.refresh_token)
    .then((session) => {
      if (sessionEpoch !== epoch) {
        // Logout (or another clear) happened while this refresh was in flight.
        return session;
      }
      writeStorage(SESSION_KEY, session);
      return session;
    })
    .catch((error: unknown) => {
      // Only clear the session this refresh belongs to; a newer login must
      // not be wiped by a stale failure.
      if (sessionEpoch === epoch) {
        clearSession();
      }
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function performLogout(): Promise<void> {
  loggingOut = true;
  try {
    // Wait for an in-flight refresh so the remote revocation uses the live
    // rotated tokens instead of an already-expired pair.
    const pending = refreshPromise;
    if (pending !== null) {
      try {
        await pending;
      } catch {
        // A failed refresh already cleared the stored session.
      }
    }
    const current = getSession();
    if (current === null) {
      clearSession();
      return;
    }
    // Start the remote revocation while the live access token is still stored.
    const remote = apiLogout(current.refresh_token);
    clearSession();
    try {
      await remote;
    } catch {
      // Local logout still succeeds when revocation fails.
    }
  } finally {
    loggingOut = false;
  }
}

export function logout(): Promise<void> {
  if (logoutPromise !== null) {
    return logoutPromise;
  }
  logoutPromise = performLogout().finally(() => {
    logoutPromise = null;
  });
  return logoutPromise;
}

function noticeKey(notice: AppNotice): string {
  return `${notice.report_id}:${notice.moderation_status}`;
}

function readSeenNotices(): string[] {
  const stored = readStorage<unknown>(NOTICE_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter((item): item is string => typeof item === 'string');
}

function writeSeenNotices(keys: string[]): void {
  writeStorage(NOTICE_KEY, keys);
}

function showModal(title: string, content: string): void {
  try {
    wx.showModal({ title, content, showCancel: false, confirmText: '知道了' });
  } catch {
    // Notifications are best effort.
  }
}

function noticeMessage(notices: AppNotice[]): string {
  const first = notices[0];
  if (first === undefined) {
    return '';
  }
  const reason = first.reject_reason === null ? '' : `，原因：${first.reject_reason}`;
  if (notices.length === 1) {
    return `你的内容${moderationStatusLabel(first.moderation_status)}${reason}。可在「我的」中查看。`;
  }
  return `你有 ${notices.length} 条内容有新的审核结果，可在「我的」中查看。`;
}

/**
 * Shows one-time moderation notices and the publishing restriction date.
 * Seen notices are recorded by report_id + moderation_status before display.
 */
export function showMeAlerts(me: AppMe): void {
  const seen = readSeenNotices();
  const unseen = me.notices.filter((notice) => !seen.includes(noticeKey(notice)));
  if (unseen.length > 0) {
    writeSeenNotices([...seen, ...unseen.map((notice) => noticeKey(notice))]);
    showModal('内容审核通知', noticeMessage(unseen));
    return;
  }
  if (!me.can_publish) {
    const date = restrictionDateText(me.restricted_until);
    const marker = date === '' ? 'blocked' : date;
    const stored = readStorage<unknown>(RESTRICTION_KEY);
    if (stored !== marker) {
      writeStorage(RESTRICTION_KEY, marker);
      showModal(
        '发布受限',
        date === ''
          ? '当前账号暂不能发布内容。'
          : `当前账号暂不能发布内容，限制解除日期为 ${date}。`,
      );
    }
  }
}

export function getMe(): Promise<AppMe> {
  return fetchMe().then((me) => {
    showMeAlerts(me);
    return me;
  });
}
