import { track } from '../../analytics';
import {
  contentTypeLabel,
  dictionaryLabel,
  freshnessLabel,
  getClientConfig,
  getDictionaries,
  getSpot,
  listSpotReports,
  mediaUrl,
  openStatusLabel,
  relativeTimeText,
  type PublicDictionaries,
  type PublicReportItem,
  type PublicSpotDetail,
  type ReportContentType,
  type SpotReportParams,
} from '../../api';
import { ensureSession, getMe, getSession } from '../../session';

interface DisplayPoiGroup {
  poi_type: string;
  label: string;
  count: number;
  names: string;
}

type ReportFilterKey = 'all' | ReportContentType;

interface ReportFilter {
  key: ReportFilterKey;
  label: string;
}

interface DisplayReport {
  report_id: string;
  typeLabel: string;
  content: string;
  catchText: string;
  authorText: string;
  timeText: string;
}

interface DetailData {
  spot: PublicSpotDetail | null;
  dictionaries: PublicDictionaries | null;
  loading: boolean;
  error: string;
  images: string[];
  fishLabels: string[];
  methodLabels: string[];
  fishText: string;
  methodText: string;
  feeLabel: string;
  feeText: string;
  waterLabel: string;
  venueLabel: string;
  openLabel: string;
  openTone: string;
  freshnessText: string;
  freshnessTone: string;
  verifiedText: string;
  poiGroups: DisplayPoiGroup[];
  markers: Array<{
    id: number;
    latitude: number;
    longitude: number;
    iconPath: string;
    width: number;
    height: number;
    label: {
      content: string;
      color: string;
      bgColor: string;
      borderRadius: number;
      padding: number;
      fontSize: number;
    };
  }>;
  canNavigate: boolean;
  ugcVisible: boolean;
  reports: DisplayReport[];
  reportTotal: number;
  reportCursor: string | null;
  reportHasMore: boolean;
  reportsLoading: boolean;
  reportsLoadingMore: boolean;
  reportsError: string;
  reportFilter: ReportFilterKey;
  reportFilters: ReportFilter[];
  reportsReady: boolean;
  reportSeq: number;
  loginSheetOpen: boolean;
  loggingIn: boolean;
}

interface LoadOptions {
  spot_id?: string;
}

interface ImageTapEvent {
  currentTarget: { dataset: { index: string } };
}

interface PoiGroupTapEvent {
  currentTarget: { dataset: { type: string } };
}

interface ReportFilterTapEvent {
  currentTarget: { dataset: { key: string } };
}

interface DetailMethods {
  load(spotId: string): Promise<void>;
  display(spot: PublicSpotDetail): void;
  loadReports(reset: boolean): Promise<void>;
  displayReport(item: PublicReportItem): DisplayReport;
  changeReportFilter(event: ReportFilterTapEvent): void;
  loadMoreReports(): void;
  retryReports(): void;
  openWrite(): void;
  closeLoginSheet(): void;
  loginAndWrite(): Promise<void>;
  openCreatePage(): void;
  refreshMe(): void;
  previewImage(event: ImageTapEvent): void;
  openPoiList(event: PoiGroupTapEvent): void;
  navigate(): void;
  copyAddress(): void;
  retry(): void;
  noop(): void;
}

const INITIAL_REPORT_LIMIT = 3;
const MORE_REPORT_LIMIT = 10;
const REPORT_FILTERS: ReportFilter[] = [
  { key: 'all', label: '全部' },
  { key: 'comment', label: '评论' },
  { key: 'catch', label: '鱼获' },
  { key: 'intel', label: '情报' },
];

let currentSpotId = '';

Page<DetailData, DetailMethods>({
  data: {
    spot: null,
    dictionaries: null,
    loading: true,
    error: '',
    images: [],
    fishLabels: [],
    methodLabels: [],
    fishText: '',
    methodText: '',
    feeLabel: '',
    feeText: '',
    waterLabel: '',
    venueLabel: '',
    openLabel: '',
    openTone: '',
    freshnessText: '',
    freshnessTone: '',
    verifiedText: '',
    poiGroups: [],
    markers: [],
    canNavigate: false,
    ugcVisible: false,
    reports: [],
    reportTotal: 0,
    reportCursor: null,
    reportHasMore: false,
    reportsLoading: false,
    reportsLoadingMore: false,
    reportsError: '',
    reportFilter: 'all',
    reportFilters: REPORT_FILTERS,
    reportsReady: false,
    reportSeq: 0,
    loginSheetOpen: false,
    loggingIn: false,
  },

  onLoad(options: LoadOptions) {
    currentSpotId = options.spot_id ?? '';
    if (currentSpotId === '') {
      this.setData({ loading: false, error: '缺少钓点编号' });
      return;
    }
    void this.load(currentSpotId);
  },

  onShow() {
    // The first onShow runs while the page is still loading, so reportsReady
    // distinguishes the initial display from returning to the page.
    if (!this.data.reportsReady || !this.data.ugcVisible) {
      return;
    }
    void this.loadReports(true);
    this.refreshMe();
  },

  async load(spotId: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    const [dictionariesResult, configResult, spotResult] = await Promise.allSettled([
      getDictionaries(),
      getClientConfig(),
      getSpot(spotId),
    ] as const);

    if (spotResult.status === 'rejected') {
      const reason = spotResult.reason;
      const message = reason instanceof Error ? reason.message : '钓点加载失败';
      track('error_event', { page: 'detail', code: '', message });
      this.setData({ loading: false, error: message });
      return;
    }

    const dictionaries =
      dictionariesResult.status === 'fulfilled' ? dictionariesResult.value : null;
    const config = configResult.status === 'fulfilled' ? configResult.value : null;
    const spot = spotResult.value;
    const ugcVisible = config?.features.ugc === true && !spot.is_banned;

    this.setData({ dictionaries, ugcVisible });
    this.display(spot);
    this.setData({ loading: false });
    track('spot_detail_view', { spot_id: spot.spot_id, source: 'list' });

    if (ugcVisible) {
      track('ugc_section_view', { spot_id: spot.spot_id });
      await this.loadReports(true);
    }
  },

  async loadReports(reset: boolean): Promise<void> {
    if (!this.data.ugcVisible || currentSpotId === '') {
      return;
    }
    if (!reset && (this.data.reportCursor === null || this.data.reportsLoadingMore)) {
      return;
    }
    const seq = this.data.reportSeq + 1;
    if (reset) {
      this.setData({
        reportSeq: seq,
        reportsLoading: true,
        reportsError: '',
        reports: [],
        reportCursor: null,
        reportHasMore: false,
      });
    } else {
      this.setData({ reportSeq: seq, reportsLoadingMore: true, reportsError: '' });
    }

    const params: SpotReportParams = {
      limit: reset ? INITIAL_REPORT_LIMIT : MORE_REPORT_LIMIT,
      content_type: this.data.reportFilter === 'all' ? undefined : this.data.reportFilter,
      cursor: reset ? undefined : (this.data.reportCursor ?? undefined),
    };

    try {
      const page = await listSpotReports(currentSpotId, params);
      if (this.data.reportSeq !== seq) {
        return;
      }
      const items = page.items.map((item) => this.displayReport(item));
      this.setData({
        reports: reset ? items : [...this.data.reports, ...items],
        reportTotal: page.total,
        reportCursor: page.next_cursor,
        reportHasMore: page.next_cursor !== null,
        reportsLoading: false,
        reportsLoadingMore: false,
        reportsError: '',
        reportsReady: true,
      });
    } catch (error) {
      if (this.data.reportSeq !== seq) {
        return;
      }
      this.setData({
        reportsLoading: false,
        reportsLoadingMore: false,
        reportsError: error instanceof Error ? error.message : '情报加载失败',
        reportsReady: true,
      });
    }
  },

  displayReport(item: PublicReportItem): DisplayReport {
    let catchText = '';
    if (item.content_type === 'catch' && item.fish_key !== null) {
      const fish = dictionaryLabel(this.data.dictionaries?.fish_types, item.fish_key);
      const weight =
        item.catch_weight_kg === null ? '' : `${Number(item.catch_weight_kg)} kg`;
      catchText = weight === '' ? fish : `${fish} · ${weight}`;
    }
    return {
      report_id: item.report_id,
      typeLabel: contentTypeLabel(item.content_type),
      content: item.content,
      catchText,
      authorText: item.author.nickname ?? '钓友',
      timeText: relativeTimeText(item.created_at),
    };
  },

  changeReportFilter(event: ReportFilterTapEvent): void {
    const key = event.currentTarget.dataset.key;
    const filter = REPORT_FILTERS.find((item) => item.key === key);
    if (filter === undefined || filter.key === this.data.reportFilter) {
      return;
    }
    // Keep the previous total visible while the filtered page loads.
    this.setData({ reportFilter: filter.key });
    void this.loadReports(true);
  },

  loadMoreReports(): void {
    void this.loadReports(false);
  },

  retryReports(): void {
    void this.loadReports(true);
  },

  openWrite(): void {
    if (!this.data.ugcVisible) {
      return;
    }
    track('ugc_create_open', { spot_id: currentSpotId });
    if (getSession() !== null) {
      this.openCreatePage();
      return;
    }
    this.setData({ loginSheetOpen: true });
  },

  closeLoginSheet(): void {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({ loginSheetOpen: false });
  },

  async loginAndWrite(): Promise<void> {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({ loggingIn: true });
    track('ugc_login_start');
    try {
      await ensureSession();
      track('ugc_login_success');
      this.setData({ loginSheetOpen: false, loggingIn: false });
      this.refreshMe();
      this.openCreatePage();
    } catch {
      track('ugc_login_fail', { result: 'fail' });
      this.setData({ loggingIn: false });
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  },

  openCreatePage(): void {
    const spotName = this.data.spot?.spot_name ?? '';
    wx.navigateTo({
      url: `/pages/report/create?spot_id=${encodeURIComponent(currentSpotId)}&spot_name=${encodeURIComponent(spotName)}`,
    });
  },

  refreshMe(): void {
    if (getSession() === null) {
      return;
    }
    void getMe().catch(() => undefined);
  },

  display(spot: PublicSpotDetail): void {
    const dictionaries = this.data.dictionaries;
    const freshness =
      spot.freshness === 'fresh' ? '' : freshnessLabel(spot.freshness);
    const poiGroups = spot.poi_summary.map((group) => ({
      poi_type: group.poi_type,
      label:
        dictionaryLabel(dictionaries?.poi_types, group.poi_type) || group.poi_type,
      count: group.count,
      names: group.items.map((item) => item.poi_name).join('、'),
    }));
    const navigation = spot.navigation;
    const fishLabels = spot.fish_types.map(
      (key) => dictionaryLabel(dictionaries?.fish_types, key) || key,
    );
    const methodLabels = spot.fishing_method.map(
      (key) => dictionaryLabel(dictionaries?.fishing_methods, key) || key,
    );
    const feeLabel =
      dictionaryLabel(dictionaries?.fee_status, spot.fee_status) || '收费未标注';
    this.setData({
      spot,
      images: spot.images.map((url) => mediaUrl(url)),
      fishLabels,
      methodLabels,
      fishText: fishLabels.join('、'),
      methodText: methodLabels.join('、'),
      feeLabel,
      feeText: spot.fee_detail ? `${feeLabel} · ${spot.fee_detail}` : feeLabel,
      waterLabel: dictionaryLabel(dictionaries?.water_types, spot.water_type),
      venueLabel: dictionaryLabel(dictionaries?.venue_types, spot.venue_type),
      openLabel: openStatusLabel(spot.open_status),
      openTone:
        spot.open_status === 'banned'
          ? 'tag-danger'
          : spot.open_status === 'paused'
            ? 'tag-warn'
            : '',
      freshnessText: freshness,
      freshnessTone:
        spot.freshness === 'expired'
          ? 'tag-danger'
          : spot.freshness === 'stale'
            ? 'tag-warn'
            : '',
      verifiedText:
        spot.verified_days_ago === null
          ? '尚未核实'
          : spot.verified_days_ago === 0
            ? '今天已核实'
            : `${spot.verified_days_ago} 天前核实`,
      poiGroups,
      markers: [
        {
          id: 0,
          latitude: Number(spot.latitude),
          longitude: Number(spot.longitude),
          iconPath: '/assets/pin.png',
          width: 30,
          height: 38,
          label: {
            content: spot.spot_name,
            color: '#17211e',
            bgColor: '#ffffff',
            borderRadius: 6,
            padding: 4,
            fontSize: 10,
          },
        },
      ],
      canNavigate: !spot.is_banned && navigation !== null,
    });
  },

  previewImage(event: ImageTapEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images;
    if (images.length === 0) {
      return;
    }
    wx.previewImage({ current: images[index], urls: images });
  },

  openPoiList(event: PoiGroupTapEvent) {
    if (currentSpotId === '') {
      return;
    }
    const poiType = event.currentTarget.dataset.type;
    track('poi_category_click', {
      spot_id: currentSpotId,
      poi_type: poiType,
    });
    wx.navigateTo({
      url: `/pages/poi/list?spot_id=${encodeURIComponent(currentSpotId)}&poi_type=${encodeURIComponent(poiType)}`,
    });
  },

  navigate() {
    const spot = this.data.spot;
    if (spot === null || spot.navigation === null || spot.is_banned) {
      return;
    }
    track('nav_button_click', { spot_id: spot.spot_id, source: 'detail' });
    wx.openLocation({
      latitude: Number(spot.navigation.latitude),
      longitude: Number(spot.navigation.longitude),
      name: spot.spot_name,
      address: spot.address ?? '',
      scale: 16,
      success: () => {
        track('nav_open_location_result', { spot_id: spot.spot_id, success: true });
      },
      fail: (error) => {
        track('nav_open_location_result', {
          spot_id: spot.spot_id,
          success: false,
          error_code: error.errMsg,
        });
        this.copyAddress();
      },
    });
  },

  copyAddress() {
    const address = this.data.spot?.address;
    if (address === null || address === undefined || address === '') {
      wx.showToast({ title: '暂无地址', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: address,
      success: () => {
        track('nav_copy_address', { spot_id: currentSpotId });
        wx.showToast({ title: '地址已复制', icon: 'success' });
      },
    });
  },

  retry() {
    if (currentSpotId !== '') {
      void this.load(currentSpotId);
    }
  },

  noop() {
    // Keeps taps inside the login sheet from closing it.
  },
});
