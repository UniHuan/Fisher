/** Domain enums use lowercase stable codes; display text is mapped by clients. */
export const OPEN_STATUS = {
  OPEN: 'open',
  PAUSED: 'paused',
  BANNED: 'banned',
} as const;

export type OpenStatus = (typeof OPEN_STATUS)[keyof typeof OPEN_STATUS];

export const SPOT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  OFFLINE: 'offline',
} as const;

export type SpotStatus = (typeof SPOT_STATUS)[keyof typeof SPOT_STATUS];

export const POI_TYPE = {
  FOOD: 'food',
  PARKING: 'parking',
  TOILET: 'toilet',
  SUPPLY: 'supply',
  ENTERTAINMENT: 'entertainment',
  LODGING: 'lodging',
} as const;

export type PoiType = (typeof POI_TYPE)[keyof typeof POI_TYPE];

export const ADMIN_ROLE = {
  SUPER_ADMIN: 'super_admin',
  OPERATOR: 'operator',
  REVIEWER: 'reviewer',
} as const;

export type AdminRole = (typeof ADMIN_ROLE)[keyof typeof ADMIN_ROLE];

export const CLIENT_TYPE = {
  MINIPROGRAM: 'miniprogram',
  IOS: 'ios',
  ADMIN: 'admin',
} as const;

export type ClientType = (typeof CLIENT_TYPE)[keyof typeof CLIENT_TYPE];
