export interface AdminPoiItem {
  poi_id: string;
  external_poi_id: string | null;
  poi_name: string;
  poi_type: string;
  latitude: string;
  longitude: string;
  address: string | null;
  rating: string | null;
  open_time: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSpotPoiItem extends AdminPoiItem {
  effective_type: string;
  poi_type_override: string | null;
  sort_order: number | null;
  distance_m: number;
}

export interface PoiSyncRunItem {
  sync_id: string;
  spot_id: string;
  status: string;
  poi_count: number;
  error_message: string | null;
  quota_used: number;
  started_at: string;
  finished_at: string | null;
}

export interface AdminSpotPoiList {
  spot_id: string;
  items: AdminSpotPoiItem[];
  last_sync: PoiSyncRunItem | null;
}

export interface ProviderPoiItem {
  external_poi_id: string;
  poi_name: string;
  poi_type: string;
  latitude: string;
  longitude: string;
  address: string | null;
  rating: string | null;
  open_time: string | null;
}

export interface ProviderPoiResult {
  items: ProviderPoiItem[];
  quotaUsed: number;
}
