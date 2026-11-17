import {
  dictionaryLabel,
  freshnessLabel,
  getDictionaries,
  getSpot,
  mediaUrl,
  openStatusLabel,
  type PublicDictionaries,
  type PublicSpotDetail,
} from '../../api';

interface DisplayPoiGroup {
  poi_type: string;
  label: string;
  count: number;
  names: string;
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

interface DetailMethods {
  load(spotId: string): Promise<void>;
  display(spot: PublicSpotDetail): void;
  previewImage(event: ImageTapEvent): void;
  openPoiList(event: PoiGroupTapEvent): void;
  navigate(): void;
  copyAddress(): void;
  retry(): void;
}

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
  },

  onLoad(options: LoadOptions) {
    currentSpotId = options.spot_id ?? '';
    if (currentSpotId === '') {
      this.setData({ loading: false, error: '缺少钓点编号' });
      return;
    }
    void this.load(currentSpotId);
  },

  async load(spotId: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    let dictionaries: PublicDictionaries | null = null;
    try {
      dictionaries = await getDictionaries();
    } catch {
      // Detail still works with raw keys.
    }
    try {
      const spot = await getSpot(spotId);
      this.setData({ dictionaries });
      this.display(spot);
      this.setData({ loading: false });
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '钓点加载失败',
      });
    }
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
    wx.navigateTo({
      url: `/pages/poi/list?spot_id=${encodeURIComponent(currentSpotId)}&poi_type=${encodeURIComponent(poiType)}`,
    });
  },

  navigate() {
    const spot = this.data.spot;
    if (spot === null || spot.navigation === null || spot.is_banned) {
      return;
    }
    wx.openLocation({
      latitude: Number(spot.navigation.latitude),
      longitude: Number(spot.navigation.longitude),
      name: spot.spot_name,
      address: spot.address ?? '',
      scale: 16,
      fail: () => {
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
        wx.showToast({ title: '地址已复制', icon: 'success' });
      },
    });
  },

  retry() {
    if (currentSpotId !== '') {
      void this.load(currentSpotId);
    }
  },
});
