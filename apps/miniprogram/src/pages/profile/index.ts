import { track } from '../../analytics';
import {
  CLIENT_VERSION,
  contentTypeLabel,
  deleteReport as apiDeleteReport,
  getClientConfig,
  listMyReports,
  loginFailureText,
  mediaUrl,
  moderationStatusLabel,
  moderationStatusTone,
  relativeTimeText,
  type MyReportItem,
  type MyReportStatusFilter,
} from '../../api';
import {
  ensureSession,
  getMe,
  getSession,
  logout as sessionLogout,
} from '../../session';

interface StatusFilterOption {
  key: MyReportStatusFilter;
  label: string;
}

interface DisplayMyReport {
  report_id: string;
  spotId: string;
  canOpen: boolean;
  moderationStatus: string;
  typeLabel: string;
  spotName: string;
  content: string;
  images: string[];
  statusLabel: string;
  statusTone: string;
  timeText: string;
  rejectText: string;
}

interface ProfileData {
  initialized: boolean;
  configError: string;
  ugcEnabled: boolean;
  sessionReady: boolean;
  loggingIn: boolean;
  nickname: string;
  avatarText: string;
  appVersion: string;
  filters: StatusFilterOption[];
  statusFilter: MyReportStatusFilter;
  emptyText: string;
  emptyHint: string;
  reports: DisplayMyReport[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  cursor: string | null;
  hasMore: boolean;
  total: number;
  requestSeq: number;
  termsUrl: string;
  privacyUrl: string;
  communityUrl: string;
  legalNote: string;
}

interface FilterTapEvent {
  currentTarget: { dataset: { key: string } };
}

interface ReportTapEvent {
  currentTarget: { dataset: { id: string } };
}

interface ReportImageTapEvent {
  currentTarget: { dataset: { id: string; index: string } };
}

interface LegalTapEvent {
  currentTarget: { dataset: { key: string } };
}

interface ProfileMethods {
  init(): Promise<void>;
  retryConfig(): void;
  login(): Promise<void>;
  loadAfterLogin(): Promise<void>;
  loadReports(reset: boolean): Promise<void>;
  displayReport(item: MyReportItem): DisplayMyReport;
  selectFilter(event: FilterTapEvent): void;
  loadMoreReports(): void;
  retry(): void;
  openContent(event: ReportTapEvent): void;
  previewImage(event: ReportImageTapEvent): void;
  confirmDelete(event: ReportTapEvent): void;
  deleteReport(item: DisplayMyReport): Promise<void>;
  openLegal(event: LegalTapEvent): void;
  copyLegalUrl(url: string): void;
  logout(): void;
  reset(): void;
  onShow(): void;
}

const STATUS_FILTERS: StatusFilterOption[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '审核中' },
  { key: 'published', label: '已发布' },
  { key: 'rejected', label: '已驳回' },
  { key: 'removed', label: '已下架' },
];

const EMPTY_TEXT: Record<MyReportStatusFilter, string> = {
  all: '还没有发布内容',
  pending: '没有审核中的内容',
  published: '还没有已发布的内容',
  rejected: '没有已驳回的内容',
  removed: '没有已下架的内容',
};

const EMPTY_HINT: Record<MyReportStatusFilter, string> = {
  all: '在钓点详情页写下第一条评论、鱼获或情报。',
  pending: '审核中的内容会显示在这里，通过后会出现在钓点详情页。',
  published: '发布通过后会显示在这里。',
  rejected: '被驳回的内容会显示在这里，可以点开查看原因。',
  removed: '被下架或自己删除的内容会显示在这里。',
};

const PAGE_SIZE = 10;
let firstShow = true;

Page<ProfileData, ProfileMethods>({
  data: {
    initialized: false,
    configError: '',
    ugcEnabled: false,
    sessionReady: false,
    loggingIn: false,
    nickname: '',
    avatarText: '',
    appVersion: CLIENT_VERSION,
    filters: STATUS_FILTERS,
    statusFilter: 'all',
    emptyText: EMPTY_TEXT.all,
    emptyHint: EMPTY_HINT.all,
    reports: [],
    loading: false,
    loadingMore: false,
    error: '',
    cursor: null,
    hasMore: false,
    total: 0,
    requestSeq: 0,
    termsUrl: '',
    privacyUrl: '',
    communityUrl: '',
    legalNote: '',
  },

  onLoad() {
    void this.init();
  },

  onShow() {
    if (firstShow) {
      firstShow = false;
      return;
    }
    if (!this.data.initialized || !this.data.ugcEnabled) {
      return;
    }
    if (getSession() === null) {
      if (this.data.sessionReady) {
        this.reset();
      }
      return;
    }
    if (!this.data.loading) {
      void this.loadAfterLogin();
    }
  },

  async init(): Promise<void> {
    const config = await getClientConfig().catch(() => null);
    const ugcEnabled = config?.features.ugc === true;
    const legal = config?.legal ?? null;
    const termsUrl = legal?.terms_url ?? '';
    const privacyUrl = legal?.privacy_url ?? '';
    const communityUrl = legal?.community_url ?? '';
    this.setData({
      initialized: true,
      configError: config === null ? '配置加载失败，请重试' : '',
      ugcEnabled,
      sessionReady: getSession() !== null,
      termsUrl,
      privacyUrl,
      communityUrl,
      legalNote:
        termsUrl === '' && privacyUrl === '' && communityUrl === ''
          ? '法务链接暂未开放'
          : '',
    });
    if (ugcEnabled && getSession() !== null) {
      await this.loadAfterLogin();
    }
  },

  retryConfig(): void {
    void this.init();
  },

  async login(): Promise<void> {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({ loggingIn: true, error: '' });
    track('ugc_login_start');
    try {
      await ensureSession();
      track('ugc_login_success');
      this.setData({ sessionReady: true, loggingIn: false });
      await this.loadAfterLogin();
    } catch (error) {
      track('ugc_login_fail', { result: 'fail' });
      this.setData({ loggingIn: false });
      wx.showToast({ title: loginFailureText(error), icon: 'none' });
    }
  },

  async loadAfterLogin(): Promise<void> {
    this.setData({ sessionReady: true, loading: true, error: '' });
    try {
      const me = await getMe();
      const nickname = me.user.nickname ?? '钓友';
      this.setData({
        nickname,
        avatarText: Array.from(nickname)[0] ?? '钓',
      });
    } catch {
      if (getSession() === null) {
        this.reset();
        return;
      }
      // A profile refresh failure must not block the content list.
    }
    await this.loadReports(true);
  },

  async loadReports(reset: boolean): Promise<void> {
    if (!this.data.ugcEnabled) {
      return;
    }
    if (getSession() === null) {
      this.reset();
      return;
    }
    if (!reset && (this.data.cursor === null || this.data.loadingMore)) {
      return;
    }
    const seq = this.data.requestSeq + 1;
    if (reset) {
      this.setData({
        requestSeq: seq,
        loading: true,
        error: '',
        reports: [],
        cursor: null,
        hasMore: false,
      });
    } else {
      this.setData({ requestSeq: seq, loadingMore: true, error: '' });
    }

    try {
      const page = await listMyReports(
        this.data.statusFilter,
        reset ? undefined : (this.data.cursor ?? undefined),
        PAGE_SIZE,
      );
      if (this.data.requestSeq !== seq) {
        return;
      }
      const items = page.items.map((item) => this.displayReport(item));
      this.setData({
        reports: reset ? items : [...this.data.reports, ...items],
        total: page.total,
        cursor: page.next_cursor,
        hasMore: page.next_cursor !== null,
        loading: false,
        loadingMore: false,
        error: '',
      });
      if (reset) {
        track('my_content_view', { status: this.data.statusFilter });
      }
    } catch (error) {
      if (this.data.requestSeq !== seq) {
        return;
      }
      if (getSession() === null) {
        this.reset();
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        error: error instanceof Error ? error.message : '内容加载失败',
      });
    }
  },

  displayReport(item: MyReportItem): DisplayMyReport {
    const statusLabel = moderationStatusLabel(item.moderation_status);
    const rejected =
      item.moderation_status === 'machine_rejected' ||
      item.moderation_status === 'human_rejected';
    const removed = item.moderation_status === 'removed';
    const reason = item.reject_reason ?? '';
    let rejectText = '';
    if (rejected && reason !== '') {
      rejectText = `驳回原因：${reason}`;
    } else if (removed && reason !== '') {
      rejectText = `下架原因：${reason}`;
    }
    return {
      report_id: item.report_id,
      spotId: item.spot.spot_id,
      canOpen: item.spot.can_open,
      moderationStatus: item.moderation_status,
      typeLabel: contentTypeLabel(item.content_type),
      spotName: item.spot.spot_name,
      content: item.content,
      images: item.images.map((url) => mediaUrl(url)),
      statusLabel,
      statusTone: moderationStatusTone(item.moderation_status),
      timeText: relativeTimeText(item.created_at),
      rejectText,
    };
  },

  selectFilter(event: FilterTapEvent): void {
    const key = event.currentTarget.dataset.key;
    const filter = STATUS_FILTERS.find((item) => item.key === key);
    if (filter === undefined || filter.key === this.data.statusFilter) {
      return;
    }
    track('my_content_filter', { status: filter.key });
    this.setData({
      statusFilter: filter.key,
      emptyText: EMPTY_TEXT[filter.key],
      emptyHint: EMPTY_HINT[filter.key],
    });
    void this.loadReports(true);
  },

  loadMoreReports(): void {
    void this.loadReports(false);
  },

  retry(): void {
    void this.loadReports(true);
  },

  openContent(event: ReportTapEvent): void {
    const item = this.data.reports.find(
      (report) => report.report_id === event.currentTarget.dataset.id,
    );
    if (item === undefined) {
      return;
    }
    if (!item.canOpen) {
      wx.showToast({ title: '该钓点暂不可访问', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/detail/detail?spot_id=${encodeURIComponent(item.spotId)}`,
    });
  },

  previewImage(event: ReportImageTapEvent): void {
    const item = this.data.reports.find(
      (report) => report.report_id === event.currentTarget.dataset.id,
    );
    if (item === undefined || item.images.length === 0) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    wx.previewImage({ current: item.images[index], urls: item.images });
  },

  confirmDelete(event: ReportTapEvent): void {
    const item = this.data.reports.find(
      (report) => report.report_id === event.currentTarget.dataset.id,
    );
    if (item === undefined) {
      return;
    }
    wx.showModal({
      title: '删除这条内容',
      content: '删除后不可恢复，确定删除吗？',
      confirmText: '删除',
      confirmColor: '#A93226',
      cancelText: '取消',
      success: (result) => {
        if (result.confirm) {
          void this.deleteReport(item);
        }
      },
    });
  },

  async deleteReport(item: DisplayMyReport): Promise<void> {
    try {
      await apiDeleteReport(item.report_id);
      track('my_content_delete', {
        status: item.moderationStatus,
        result: 'success',
      });
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadReports(true);
    } catch {
      track('my_content_delete', {
        status: item.moderationStatus,
        result: 'fail',
      });
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },

  openLegal(event: LegalTapEvent): void {
    const key = event.currentTarget.dataset.key;
    const urls: Record<string, string> = {
      terms: this.data.termsUrl,
      privacy: this.data.privacyUrl,
      community: this.data.communityUrl,
    };
    const url = urls[key] ?? '';
    if (url === '') {
      wx.showToast({ title: '法务链接暂未开放', icon: 'none' });
      return;
    }
    let webViewAvailable: boolean;
    try {
      webViewAvailable = wx.canIUse('web-view');
    } catch {
      webViewAvailable = true;
    }
    if (!webViewAvailable) {
      this.copyLegalUrl(url);
      return;
    }
    wx.navigateTo({
      url: `/pages/legal/legal?url=${encodeURIComponent(url)}`,
      fail: () => this.copyLegalUrl(url),
    });
  },

  copyLegalUrl(url: string): void {
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' });
      },
    });
  },

  logout(): void {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新微信登录。',
      confirmText: '退出',
      cancelText: '取消',
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        void sessionLogout().then(() => {
          this.reset();
        });
      },
    });
  },

  reset(): void {
    this.setData({
      requestSeq: this.data.requestSeq + 1,
      sessionReady: false,
      nickname: '',
      avatarText: '',
      reports: [],
      total: 0,
      cursor: null,
      hasMore: false,
      error: '',
      loading: false,
      loadingMore: false,
      statusFilter: 'all',
      emptyText: EMPTY_TEXT.all,
      emptyHint: EMPTY_HINT.all,
    });
  },
});
