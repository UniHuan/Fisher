import { track } from '../../analytics';
import { conditionFreshnessText, conditionSummary } from '../../condition';
import {
  dictionaryLabel,
  distanceText,
  freshnessLabel,
  getDictionaries,
  listSpots,
  mediaUrl,
  openStatusLabel,
  type PublicDictionaries,
  type PublicSpotListItem,
} from '../../api';

interface DisplaySpot {
  spot_id: string;
  spot_name: string;
  districtLabel: string;
  fishLabels: string[];
  feeLabel: string;
  openLabel: string;
  openTone: string;
  freshnessLabel: string;
  freshnessTone: string;
  conditionText: string;
  conditionFreshness: string;
  distanceText: string;
  cover: string;
  isCore: boolean;
}

interface FilterOption {
  key: string;
  label: string;
  selected: boolean;
}

interface IndexData {
  dictionaries: PublicDictionaries | null;
  spots: DisplaySpot[];
  skeletons: number[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  initialized: boolean;
  error: string;
  keyword: string;
  districtLabels: string[];
  districtIndex: number;
  includeBanned: boolean;
  location: { latitude: number; longitude: number } | null;
  locationDenied: boolean;
  filterOpen: boolean;
  filterCount: number;
  filterFish: string[];
  filterFee: string;
  filterWater: string[];
  filterVenue: string[];
  draftFish: string[];
  draftFee: string;
  draftWater: string[];
  draftVenue: string[];
  fishOptions: FilterOption[];
  feeOptions: FilterOption[];
  waterOptions: FilterOption[];
  venueOptions: FilterOption[];
}

interface InputEvent {
  detail: { value: string };
}

interface PickerEvent {
  detail: { value: string };
}

interface SwitchEvent {
  detail: { value: boolean };
}

interface TapEvent {
  currentTarget: { dataset: { id: string; index?: string } };
}

interface FilterTapEvent {
  currentTarget: { dataset: { value: string; section?: string } };
}

interface SingleFilterEvent {
  currentTarget: { dataset: { section: string; value: string } };
}

interface IndexMethods {
  loadDictionaries(): Promise<void>;
  loadSpots(reset: boolean, source?: 'filter' | 'search'): Promise<void>;
  clearKeyword(): void;
  displaySpot(item: PublicSpotListItem): DisplaySpot;
  onShow(): void;
  onSearchSubmit(): void;
  onKeywordInput(event: InputEvent): void;
  onDistrictChange(event: PickerEvent): void;
  onBannedChange(event: SwitchEvent): void;
  onLocationTap(): void;
  onLocationAction(): void;
  openSettings(): void;
  openFilters(): void;
  closeFilters(): void;
  toggleFish(event: FilterTapEvent): void;
  toggleMulti(event: FilterTapEvent): void;
  selectFilter(event: SingleFilterEvent): void;
  resetDraftFilters(): void;
  applyFilters(): void;
  refreshFilterOptions(): void;
  noop(): void;
  resetFilters(): void;
  retry(): void;
  openDetail(event: TapEvent): void;
}

let searchTimer: number | undefined;

Page<IndexData, IndexMethods>({
  data: {
    dictionaries: null,
    spots: [],
    skeletons: [1, 2, 3],
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    loading: false,
    initialized: false,
    error: '',
    keyword: '',
    districtLabels: ['全部区域'],
    districtIndex: 0,
    includeBanned: false,
    location: null,
    locationDenied: false,
    filterOpen: false,
    filterCount: 0,
    filterFish: [],
    filterFee: '',
    filterWater: [],
    filterVenue: [],
    draftFish: [],
    draftFee: '',
    draftWater: [],
    draftVenue: [],
    fishOptions: [],
    feeOptions: [],
    waterOptions: [],
    venueOptions: [],
  },

  async onLoad() {
    await this.loadDictionaries();
    await this.loadSpots(true);
  },

  onShow() {
    track('home_view', {
      tab: 'list',
      has_location: this.data.location !== null,
    });
  },

  onPullDownRefresh() {
    void this.loadSpots(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      void this.loadSpots(false);
    }
  },

  async loadDictionaries(): Promise<void> {
    try {
      const dictionaries = await getDictionaries();
      this.setData({
        dictionaries,
        districtLabels: ['全部区域'].concat(
          dictionaries.districts.map((item) => item.label),
        ),
      });
    } catch {
      // Lists still work with raw dictionary keys if this bootstrap call fails.
    }
  },

  displaySpot(item: PublicSpotListItem): DisplaySpot {
    const dictionaries = this.data.dictionaries;
    const freshness = item.freshness;
    return {
      spot_id: item.spot_id,
      spot_name: item.spot_name,
      districtLabel: item.district ?? '区域未填',
      fishLabels: item.fish_types
        .slice(0, 3)
        .map((key) => dictionaryLabel(dictionaries?.fish_types, key)),
      feeLabel: dictionaryLabel(dictionaries?.fee_status, item.fee_status) || '收费未标注',
      openLabel: openStatusLabel(item.open_status),
      openTone:
        item.open_status === 'banned'
          ? 'tag-danger'
          : item.open_status === 'paused'
            ? 'tag-warn'
            : '',
      freshnessLabel: freshness === 'fresh' ? '' : freshnessLabel(freshness),
      freshnessTone:
        freshness === 'expired'
          ? 'tag-danger'
          : freshness === 'stale'
            ? 'tag-warn'
            : '',
      conditionText:
        item.latest_condition === null ? '' : conditionSummary(item.latest_condition),
      conditionFreshness:
        item.latest_condition === null
          ? ''
          : conditionFreshnessText(item.latest_condition),
      distanceText: distanceText(item.distance_m),
      cover: mediaUrl(item.cover_image_url),
      isCore: item.is_core,
    };
  },

  async loadSpots(reset: boolean, source?: 'filter' | 'search'): Promise<void> {
    if (this.data.loading) {
      return;
    }
    const nextPage = reset ? 1 : this.data.page + 1;
    const district =
      this.data.districtIndex > 0
        ? this.data.dictionaries?.districts[this.data.districtIndex - 1]?.key
        : undefined;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listSpots({
        keyword: this.data.keyword.trim() || undefined,
        district,
        fish_types: this.data.filterFish.join(',') || undefined,
        fee_status: this.data.filterFee || undefined,
        water_type: this.data.filterWater.join(',') || undefined,
        venue_type: this.data.filterVenue.join(',') || undefined,
        include_banned: this.data.includeBanned,
        page: nextPage,
        page_size: this.data.pageSize,
        latitude: this.data.location?.latitude,
        longitude: this.data.location?.longitude,
      });
      if (source === 'filter') {
        track('filter_apply', {
          district:
            this.data.districtIndex > 0
              ? (this.data.dictionaries?.districts[this.data.districtIndex - 1]?.key ?? '')
              : '',
          fish_types: this.data.filterFish,
          fee_status: this.data.filterFee,
          water_type: this.data.filterWater,
          venue_type: this.data.filterVenue,
          include_banned: this.data.includeBanned,
          result_count: result.total,
        });
      } else if (source === 'search') {
        track('search_submit', {
          keyword: this.data.keyword.trim(),
          result_count: result.total,
        });
      }
      const items = result.items.map((item) => this.displaySpot(item));
      this.setData({
        spots: reset ? items : this.data.spots.concat(items),
        page: nextPage,
        total: result.total,
        hasMore: result.has_more,
        loading: false,
        initialized: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载失败，请稍后重试';
      track('error_event', { page: 'index', code: '', message });
      this.setData({
        loading: false,
        initialized: true,
        error: message,
      });
    }
  },

  onSearchSubmit() {
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    void this.loadSpots(true, 'search');
  },

  onKeywordInput(event: InputEvent) {
    this.setData({ keyword: event.detail.value });
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
      void this.loadSpots(true);
    }, 300);
  },

  clearKeyword() {
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    this.setData({ keyword: '' });
    void this.loadSpots(true);
  },

  onDistrictChange(event: PickerEvent) {
    this.setData({ districtIndex: Number(event.detail.value) });
    void this.loadSpots(true);
  },

  onBannedChange(event: SwitchEvent) {
    this.setData({ includeBanned: event.detail.value });
    void this.loadSpots(true);
  },

  onLocationTap() {
    wx.getLocation({
      type: 'gcj02',
      success: (location) => {
        track('location_permission', { result: 'granted', trigger: 'list' });
        this.setData({
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          locationDenied: false,
        });
        void this.loadSpots(true);
      },
      fail: () => {
        track('location_permission', { result: 'denied', trigger: 'list' });
        this.setData({ locationDenied: true });
        wx.showToast({ title: '未获得定位权限', icon: 'none' });
      },
    });
  },

  onLocationAction() {
    if (this.data.locationDenied) {
      this.openSettings();
      return;
    }
    this.onLocationTap();
  },

  openSettings() {
    wx.openSetting({
      success: (result) => {
        if (result.authSetting['scope.userLocation']) {
          this.onLocationTap();
        }
      },
    });
  },

  openFilters() {
    track('filter_open', { source: 'index' });
    this.setData({
      filterOpen: true,
      draftFish: this.data.filterFish.slice(),
      draftFee: this.data.filterFee,
      draftWater: this.data.filterWater.slice(),
      draftVenue: this.data.filterVenue.slice(),
    });
    this.refreshFilterOptions();
  },

  closeFilters() {
    this.setData({ filterOpen: false });
  },

  refreshFilterOptions() {
    const dictionaries = this.data.dictionaries;
    const fish = this.data.draftFish;
    const water = this.data.draftWater;
    const venue = this.data.draftVenue;
    const singleOptions = (
      keys: Array<{ key: string; label: string }> | undefined,
      selected: string,
    ): FilterOption[] => [
      { key: '', label: '不限', selected: selected === '' },
      ...(keys ?? []).map((item) => ({
        key: item.key,
        label: item.label,
        selected: selected === item.key,
      })),
    ];
    const multiOptions = (
      keys: Array<{ key: string; label: string }> | undefined,
      selected: string[],
    ): FilterOption[] =>
      (keys ?? []).map((item) => ({
        key: item.key,
        label: item.label,
        selected: selected.indexOf(item.key) >= 0,
      }));
    this.setData({
      fishOptions: multiOptions(dictionaries?.fish_types, fish),
      feeOptions: singleOptions(dictionaries?.fee_status, this.data.draftFee),
      waterOptions: multiOptions(dictionaries?.water_types, water),
      venueOptions: multiOptions(dictionaries?.venue_types, venue),
    });
  },

  toggleFish(event: FilterTapEvent) {
    const value = event.currentTarget.dataset.value;
    const next = this.data.draftFish.slice();
    const index = next.indexOf(value);
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(value);
    }
    this.setData({ draftFish: next });
    this.refreshFilterOptions();
  },

  toggleMulti(event: FilterTapEvent) {
    const { section, value } = event.currentTarget.dataset;
    if (section === 'water') {
      const next = this.data.draftWater.slice();
      const index = next.indexOf(value);
      if (index >= 0) {
        next.splice(index, 1);
      } else {
        next.push(value);
      }
      this.setData({ draftWater: next });
    } else if (section === 'venue') {
      const next = this.data.draftVenue.slice();
      const index = next.indexOf(value);
      if (index >= 0) {
        next.splice(index, 1);
      } else {
        next.push(value);
      }
      this.setData({ draftVenue: next });
    }
    this.refreshFilterOptions();
  },

  selectFilter(event: SingleFilterEvent) {
    const { section, value } = event.currentTarget.dataset;
    if (section === 'fee') {
      this.setData({ draftFee: value });
    }
    this.refreshFilterOptions();
  },

  resetDraftFilters() {
    track('filter_reset', {});
    this.setData({
      draftFish: [],
      draftFee: '',
      draftWater: [],
      draftVenue: [],
    });
    this.refreshFilterOptions();
  },

  applyFilters() {
    const fish = this.data.draftFish.slice();
    const water = this.data.draftWater.slice();
    const venue = this.data.draftVenue.slice();
    const filterCount =
      fish.length +
      water.length +
      venue.length +
      (this.data.draftFee === '' ? 0 : 1);
    this.setData({
      filterOpen: false,
      filterFish: fish,
      filterFee: this.data.draftFee,
      filterWater: water,
      filterVenue: venue,
      filterCount,
    });
    void this.loadSpots(true, 'filter');
  },

  noop() {
    // Stops taps inside the sheet from closing the mask.
  },

  resetFilters() {
    track('filter_reset', {});
    this.setData({
      keyword: '',
      districtIndex: 0,
      includeBanned: false,
      filterFish: [],
      filterFee: '',
      filterWater: [],
      filterVenue: [],
      draftFish: [],
      draftFee: '',
      draftWater: [],
      draftVenue: [],
      filterCount: 0,
      filterOpen: false,
      spots: [],
    });
    this.refreshFilterOptions();
    void this.loadSpots(true);
  },

  retry() {
    void this.loadSpots(true);
  },

  openDetail(event: TapEvent) {
    track('spot_card_click', {
      spot_id: event.currentTarget.dataset.id,
      position: Number(event.currentTarget.dataset.index ?? 0) + 1,
      source: 'list',
    });
    wx.navigateTo({
      url: `/pages/detail/detail?spot_id=${event.currentTarget.dataset.id}`,
    });
  },
});
