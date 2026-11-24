export type Freshness = 'fresh' | 'stale' | 'expired';

export type ConditionFreshness = 'today' | 'recent' | 'stale';

export interface PublicCondition {
  open_status: string | null;
  fee_status: string | null;
  crowd_level: string | null;
  facilities: string[];
  observed_at: string;
  reported_at: string;
  age_hours: number;
  freshness: ConditionFreshness;
  report_count_7d?: number;
}

export interface PublicNavigation {
  name: string;
  latitude: string;
  longitude: string;
  address: string | null;
}

export interface PublicSpotListItem {
  spot_id: string;
  spot_name: string;
  district: string | null;
  fish_types: string[];
  fee_status: string | null;
  water_type: string | null;
  venue_type: string | null;
  open_status: string;
  is_core: boolean;
  cover_image_url: string | null;
  verified_at: string | null;
  updated_at: string;
  freshness: Freshness;
  latest_condition: PublicCondition | null;
  distance_m?: number;
}

export interface PublicPoiItem {
  poi_id: string;
  poi_name: string;
  poi_type: string;
  latitude: string;
  longitude: string;
  address: string | null;
  rating: string | null;
  open_time: string | null;
  distance_m: number;
  source: string;
  source_label: string;
  navigation: PublicNavigation;
}

export interface PublicPoiGroup {
  poi_type: string;
  count: number;
  items: PublicPoiItem[];
}

export interface PublicSpotDetail extends PublicSpotListItem {
  city_code: string;
  address: string | null;
  latitude: string;
  longitude: string;
  fee_unit: string | null;
  fee_detail: string | null;
  fishing_method: string[];
  ban_note: string | null;
  open_hours: string | null;
  description: string | null;
  tips: string | null;
  images: string[];
  image_count: number;
  navigation: PublicNavigation | null;
  is_banned: boolean;
  verified_days_ago: number | null;
  poi_summary: PublicPoiGroup[];
}

export interface PublicPoiList {
  spot_id: string;
  items: PublicPoiItem[];
  data_source: string;
  poi_type: string | null;
}

export interface PublicMapItem {
  spot_id: string;
  spot_name: string;
  district: string | null;
  latitude: string;
  longitude: string;
  fee_status: string | null;
  open_status: string;
  is_core: boolean;
  cover_image_url: string | null;
}

export interface PublicMapCluster {
  latitude: string;
  longitude: string;
  count: number;
  bounds: {
    north: string;
    south: string;
    east: string;
    west: string;
  };
}

export interface PublicMapResult {
  mode: 'points' | 'clusters';
  total: number;
  zoom: number;
  items: PublicMapItem[];
  clusters: PublicMapCluster[];
}
