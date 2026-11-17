import {
  dictionaryLabel,
  distanceText,
  getDictionaries,
  getSpot,
  getSpotPois,
  openStatusLabel,
  type PublicDictionaries,
  type PublicPoiItem,
  type PublicSpotDetail,
} from '../../api';

interface DisplayPoi {
  poi_id: string;
  name: string;
  typeLabel: string;
  address: string;
  openTime: string;
  ratingText: string;
  distanceText: string;
  sourceLabel: string;
  latitude: number;
  longitude: number;
  navigation: PublicPoiItem['navigation'];
}

interface TypeTab {
  key: string;
  label: string;
  count: number;
}

interface PoiListData {
  spotId: string;
  spot: PublicSpotDetail | null;
  dictionaries: PublicDictionaries | null;
  typeTabs: TypeTab[];
  selectedType: string;
  allItems: PublicPoiItem[];
  visibleItems: DisplayPoi[];
  selected: DisplayPoi | null;
  sheetOpen: boolean;
  loading: boolean;
  error: string;
  dataSource: string;
  canNavigate: boolean;
  openLabel: string;
}

interface LoadOptions {
  spot_id?: string;
  poi_type?: string;
}

interface TypeTapEvent {
  currentTarget: { dataset: { type: string } };
}

interface IndexTapEvent {
  currentTarget: { dataset: { index: string } };
}

interface PoiListMethods {
  load(spotId: string, initialType?: string): Promise<void>;
  buildTabs(items: PublicPoiItem[], initialType?: string): void;
  applyType(items: PublicPoiItem[], selectedType: string): void;
  selectType(event: TypeTapEvent): void;
  openPoi(event: IndexTapEvent): void;
  closeSheet(): void;
  copyAddress(): void;
  navigate(): void;
  retry(): void;
  noop(): void;
}

function displayPoi(
  item: PublicPoiItem,
  dictionaries: PublicDictionaries | null,
): DisplayPoi {
  return {
    poi_id: item.poi_id,
    name: item.poi_name,
    typeLabel:
      dictionaryLabel(dictionaries?.poi_types, item.poi_type) || item.poi_type,
    address: item.address ?? '暂无地址',
    openTime: item.open_time ?? '营业时间未标注',
    ratingText:
      item.rating === null
        ? ''
        : `评分 ${item.rating} · ${item.source_label}`,
    distanceText: distanceText(item.distance_m) || '距离未知',
    sourceLabel: item.source_label,
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    navigation: item.navigation,
  };
}

let currentSpotId = '';
let currentInitialType = '';

Page<PoiListData, PoiListMethods>({
  data: {
    spotId: '',
    spot: null,
    dictionaries: null,
    typeTabs: [],
    selectedType: '',
    allItems: [],
    visibleItems: [],
    selected: null,
    sheetOpen: false,
    loading: true,
    error: '',
    dataSource: '',
    canNavigate: false,
    openLabel: '',
  },

  onLoad(options: LoadOptions) {
    currentSpotId = options.spot_id ?? '';
    currentInitialType = options.poi_type ?? '';
    if (currentSpotId === '') {
      this.setData({ loading: false, error: '缺少钓点编号' });
      return;
    }
    void this.load(currentSpotId, currentInitialType);
  },

  async load(spotId: string, initialType?: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    let dictionaries: PublicDictionaries | null = null;
    try {
      dictionaries = await getDictionaries();
    } catch {
      // Labels fall back to raw keys without blocking the list.
    }
    try {
      const [spot, poiList] = await Promise.all([
        getSpot(spotId),
        getSpotPois(spotId),
      ]);
      const items = poiList.items;
      this.setData({
        spotId,
        spot,
        dictionaries,
        allItems: items,
        dataSource: poiList.data_source,
        canNavigate: !spot.is_banned,
        openLabel: openStatusLabel(spot.open_status),
        loading: false,
      });
      this.buildTabs(items, initialType);
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '周边场所加载失败',
      });
    }
  },

  buildTabs(items: PublicPoiItem[], initialType?: string): void {
    const dictionaries = this.data.dictionaries;
    const seen = new Set<string>();
    const tabs: TypeTab[] = [{ key: '', label: '全部', count: items.length }];
    for (const item of items) {
      if (seen.has(item.poi_type)) {
        continue;
      }
      seen.add(item.poi_type);
      tabs.push({
        key: item.poi_type,
        label:
          dictionaryLabel(dictionaries?.poi_types, item.poi_type) || item.poi_type,
        count: items.filter((poi) => poi.poi_type === item.poi_type).length,
      });
    }
    const selectedType =
      initialType !== undefined && seen.has(initialType) ? initialType : '';
    this.setData({ typeTabs: tabs, selectedType });
    this.applyType(items, selectedType);
  },

  selectType(event: TypeTapEvent) {
    const selectedType = event.currentTarget.dataset.type;
    this.setData({ selectedType, sheetOpen: false, selected: null });
    this.applyType(this.data.allItems, selectedType);
  },

  applyType(items: PublicPoiItem[], selectedType: string): void {
    const dictionaries = this.data.dictionaries;
    const filtered =
      selectedType === ''
        ? items
        : items.filter((item) => item.poi_type === selectedType);
    this.setData({
      visibleItems: filtered.map((item) => displayPoi(item, dictionaries)),
    });
  },

  openPoi(event: IndexTapEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = this.data.visibleItems[index];
    if (selected === undefined) {
      return;
    }
    this.setData({ selected, sheetOpen: true });
  },

  closeSheet() {
    this.setData({ sheetOpen: false });
  },

  copyAddress() {
    const address = this.data.selected?.address;
    if (address === undefined || address === '' || address === '暂无地址') {
      wx.showToast({ title: '暂无地址', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: address,
      success: () => {
        wx.showToast({ title: '地址已复制', icon: 'success' });
      },
    });
  },

  navigate() {
    const selected = this.data.selected;
    if (!this.data.canNavigate || selected === null || selected.navigation === null) {
      return;
    }
    wx.openLocation({
      latitude: Number(selected.navigation.latitude),
      longitude: Number(selected.navigation.longitude),
      name: selected.name,
      address: selected.address === '暂无地址' ? '' : selected.address,
      scale: 16,
      fail: () => {
        this.copyAddress();
      },
    });
  },

  retry() {
    if (currentSpotId !== '') {
      void this.load(currentSpotId, currentInitialType);
    }
  },

  noop() {
    // Prevent taps inside the sheet from closing it.
  },
});
