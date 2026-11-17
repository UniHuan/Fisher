import type { Poi, PoiSyncRun } from '@prisma/client';
import type {
  AdminPoiItem,
  AdminSpotPoiItem,
  PoiSyncRunItem,
} from './poi.types';
import type { SpotPoiWithPoi } from './pois.repository';

export function toAdminPoiItem(row: Poi): AdminPoiItem {
  return {
    poi_id: row.poi_id,
    external_poi_id: row.external_poi_id,
    poi_name: row.poi_name,
    poi_type: row.poi_type,
    latitude: row.latitude.toFixed(6),
    longitude: row.longitude.toFixed(6),
    address: row.address,
    rating: row.rating === null ? null : row.rating.toFixed(1),
    open_time: row.open_time,
    source: row.source,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function toAdminSpotPoiItem(row: SpotPoiWithPoi): AdminSpotPoiItem {
  return {
    ...toAdminPoiItem(row.poi),
    effective_type: row.poi_type_override ?? row.poi.poi_type,
    poi_type_override: row.poi_type_override,
    sort_order: row.sort_order,
    distance_m: row.distance_m,
  };
}

export function toPoiSyncRunItem(row: PoiSyncRun): PoiSyncRunItem {
  return {
    sync_id: row.sync_id,
    spot_id: row.spot_id,
    status: row.status,
    poi_count: row.poi_count,
    error_message: row.error_message,
    quota_used: row.quota_used,
    started_at: row.started_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
  };
}
