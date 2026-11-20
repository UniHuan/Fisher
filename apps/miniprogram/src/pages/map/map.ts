import { track } from '../../analytics';
import {
  dictionaryLabel,
  getDictionaries,
  getMapSpots,
  mediaUrl,
  openStatusLabel,
  type PublicDictionaries,
  type PublicMapCluster,
  type PublicMapItem,
} from '../../api';

interface MapMarker {
  id: number;
  latitude: number;
  longitude: number;
  iconPath: string;
  width: number;
  height: number;
  label?: {
    content: string;
    color: string;
    bgColor: string;
    borderRadius: number;
    padding: number;
    fontSize: number;
  };
}

interface DisplayMapSpot {
  spot_id: string;
  spot_name: string;
  district: string;
  feeLabel: string;
  openLabel: string;
  openTone: string;
  cover: string;
}

interface MapData {
  dictionaries: PublicDictionaries | null;
  latitude: number;
  longitude: number;
  scale: number;
  markers: MapMarker[];
  mapSpots: DisplayMapSpot[];
  clusters: PublicMapCluster[];
  selected: DisplayMapSpot | null;
  loading: boolean;
  error: string;
  mode: 'points' | 'clusters';
}

interface RegionChangeEvent {
  detail: {
    type: string;
    scale?: number;
    region?: {
      northeast: { latitude: number; longitude: number };
      southwest: { latitude: number; longitude: number };
    };
  };
}

interface MarkerTapEvent {
  detail: { markerId: number };
}

interface MapMethods {
  onShow(): void;
  loadDictionaries(): Promise<void>;
  loadMap(bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<void>;
  displaySpot(item: PublicMapItem): DisplayMapSpot;
  onRegionChange(event: RegionChangeEvent): void;
  onMarkerTap(event: MarkerTapEvent): void;
  locate(): void;
  openDetail(): void;
  retry(): void;
}

Page<MapData, MapMethods>({
  data: {
    dictionaries: null,
    latitude: 22.5431,
    longitude: 114.0579,
    scale: 12,
    markers: [],
    mapSpots: [],
    clusters: [],
    selected: null,
    loading: false,
    error: '',
    mode: 'points',
  },

  async onLoad() {
    await this.loadDictionaries();
    await this.loadMap();
  },

  onShow() {
    track('home_view', { tab: 'map', has_location: false });
  },

  async loadDictionaries(): Promise<void> {
    try {
      const dictionaries = await getDictionaries();
      this.setData({ dictionaries });
    } catch {
      // The map still works with raw keys.
    }
  },

  displaySpot(item: PublicMapItem): DisplayMapSpot {
    return {
      spot_id: item.spot_id,
      spot_name: item.spot_name,
      district: item.district ?? '区域未填',
      feeLabel: dictionaryLabel(this.data.dictionaries?.fee_status, item.fee_status) || '收费未标注',
      openLabel: openStatusLabel(item.open_status),
      openTone:
        item.open_status === 'banned'
          ? 'tag-danger'
          : item.open_status === 'paused'
            ? 'tag-warn'
            : '',
      cover: mediaUrl(item.cover_image_url),
    };
  },

  async loadMap(bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<void> {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await getMapSpots({
        ...bounds,
        zoom: this.data.scale,
      });
      if (result.mode === 'clusters') {
        this.setData({
          mode: 'clusters',
          clusters: result.clusters,
          mapSpots: [],
          selected: null,
          markers: result.clusters.map((cluster, index) => ({
            id: index,
            latitude: Number(cluster.latitude),
            longitude: Number(cluster.longitude),
            iconPath: '/assets/pin.png',
            width: 30,
            height: 38,
            label: {
              content: String(cluster.count),
              color: '#ffffff',
              bgColor: '#1E6B57',
              borderRadius: 12,
              padding: 3,
              fontSize: 11,
            },
          })),
          loading: false,
        });
        return;
      }
      const spots = result.items.map((item) => this.displaySpot(item));
      this.setData({
        mode: 'points',
        mapSpots: spots,
        clusters: [],
        selected: null,
        markers: result.items.map((item, index) => ({
          id: index,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          iconPath: '/assets/pin.png',
          width: 30,
          height: 38,
        })),
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '地图加载失败';
      track('error_event', { page: 'map', code: '', message });
      this.setData({
        loading: false,
        error: message,
      });
    }
  },

  onRegionChange(event: RegionChangeEvent) {
    if (event.detail.type !== 'end') {
      return;
    }
    const scale = event.detail.scale;
    if (scale !== undefined && scale !== this.data.scale) {
      this.setData({ scale });
    }
    const region = event.detail.region;
    if (region === undefined) {
      return;
    }
    void this.loadMap({
      north: region.northeast.latitude,
      south: region.southwest.latitude,
      east: region.northeast.longitude,
      west: region.southwest.longitude,
    });
  },

  onMarkerTap(event: MarkerTapEvent) {
    if (this.data.mode === 'clusters') {
      wx.showToast({ title: '请放大地图查看', icon: 'none' });
      return;
    }
    const selected = this.data.mapSpots[event.detail.markerId] ?? null;
    if (selected !== null) {
      track('spot_card_click', {
        spot_id: selected.spot_id,
        position: event.detail.markerId + 1,
        source: 'map',
      });
    }
    this.setData({ selected });
  },

  locate() {
    wx.getLocation({
      type: 'gcj02',
      success: (location) => {
        track('location_permission', { result: 'granted', trigger: 'map' });
        this.setData({
          latitude: location.latitude,
          longitude: location.longitude,
          scale: 14,
        });
      },
      fail: () => {
        track('location_permission', { result: 'denied', trigger: 'map' });
        wx.showToast({ title: '未获得定位权限', icon: 'none' });
      },
    });
  },

  openDetail() {
    const selected = this.data.selected;
    if (selected === null) {
      return;
    }
    wx.navigateTo({
      url: `/pages/detail/detail?spot_id=${selected.spot_id}`,
    });
  },

  retry() {
    void this.loadMap();
  },
});
