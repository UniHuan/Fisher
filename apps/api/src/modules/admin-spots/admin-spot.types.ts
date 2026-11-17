import type { SpotStatus } from '@szfisher/shared';

export interface AdminSpotListItem {
  spot_id: string;
  spot_name: string;
  district: string | null;
  status: SpotStatus;
  open_status: string | null;
  is_core: boolean;
  address: string | null;
  cover_image_key: string | null;
  verified_at: string | null;
  updated_at: string;
}

export interface AdminSpotDetail {
  spot_id: string;
  spot_name: string;
  city_code: string;
  district: string | null;
  latitude: string | null;
  longitude: string | null;
  nav_latitude: string | null;
  nav_longitude: string | null;
  parking_latitude: string | null;
  parking_longitude: string | null;
  address: string | null;
  fish_types: string[];
  fee_status: string | null;
  fee_unit: string | null;
  fee_detail: string | null;
  water_type: string | null;
  venue_type: string | null;
  fishing_method: string[];
  open_status: string | null;
  ban_note: string | null;
  open_hours: string | null;
  spot_score: string | null;
  description: string | null;
  tips: string | null;
  images: string[];
  cover_image_key: string | null;
  sort_weight: number;
  is_core: boolean;
  status: SpotStatus;
  source: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DuplicateWarning {
  spot_id: string;
  spot_name: string;
  distance_m: number;
}

export interface AdminSpotWriteResult {
  spot: AdminSpotDetail;
  warnings: DuplicateWarning[];
}

export interface AdminSpotDeleteResult {
  deleted: true;
}

export interface DuplicateCandidate {
  spot_id: string;
  spot_name: string;
  latitude: { toNumber(): number } | null;
  longitude: { toNumber(): number } | null;
}
