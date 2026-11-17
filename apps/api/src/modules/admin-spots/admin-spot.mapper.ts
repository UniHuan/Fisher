import type { Prisma, Spot } from '@prisma/client';
import type { SpotStatus } from '@szfisher/shared';
import type { AdminSpotDetail, AdminSpotListItem } from './admin-spot.types';

function decimalString(value: Prisma.Decimal | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits);
}

export function toAdminSpotListItem(row: Spot): AdminSpotListItem {
  return {
    spot_id: row.spot_id,
    spot_name: row.spot_name,
    district: row.district,
    status: row.status as SpotStatus,
    open_status: row.open_status,
    is_core: row.is_core,
    address: row.address,
    cover_image_key: row.cover_image_key,
    cover_image_url: null,
    verified_at: row.verified_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export function toAdminSpotDetail(row: Spot): AdminSpotDetail {
  return {
    spot_id: row.spot_id,
    spot_name: row.spot_name,
    city_code: row.city_code,
    district: row.district,
    latitude: decimalString(row.latitude, 6),
    longitude: decimalString(row.longitude, 6),
    nav_latitude: decimalString(row.nav_latitude, 6),
    nav_longitude: decimalString(row.nav_longitude, 6),
    parking_latitude: decimalString(row.parking_latitude, 6),
    parking_longitude: decimalString(row.parking_longitude, 6),
    address: row.address,
    fish_types: row.fish_types,
    fee_status: row.fee_status,
    fee_unit: row.fee_unit,
    fee_detail: row.fee_detail,
    water_type: row.water_type,
    venue_type: row.venue_type,
    fishing_method: row.fishing_method,
    open_status: row.open_status,
    ban_note: row.ban_note,
    open_hours: row.open_hours,
    spot_score: decimalString(row.spot_score, 1),
    description: row.description,
    tips: row.tips,
    images: row.images,
    image_urls: [],
    cover_image_key: row.cover_image_key,
    cover_image_url: null,
    sort_weight: row.sort_weight,
    is_core: row.is_core,
    status: row.status as SpotStatus,
    source: row.source,
    verified_at: row.verified_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
