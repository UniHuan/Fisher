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

export const REPORT_CONTENT_TYPE = {
  COMMENT: 'comment',
  CATCH: 'catch',
  INTEL: 'intel',
} as const;

export type ReportContentType = (typeof REPORT_CONTENT_TYPE)[keyof typeof REPORT_CONTENT_TYPE];

export const MODERATION_STATUS = {
  MACHINE_PENDING: 'machine_pending',
  MACHINE_REJECTED: 'machine_rejected',
  PUBLISHED: 'published',
  HUMAN_APPROVED: 'human_approved',
  HUMAN_REJECTED: 'human_rejected',
  REMOVED: 'removed',
} as const;

export type ModerationStatus = (typeof MODERATION_STATUS)[keyof typeof MODERATION_STATUS];

export const ABUSE_REASON = {
  AD: 'ad',
  ABUSE: 'abuse',
  FALSE_INFO: 'false_info',
  PRIVACY: 'privacy',
  OTHER: 'other',
} as const;

export type AbuseReason = (typeof ABUSE_REASON)[keyof typeof ABUSE_REASON];

export const ABUSE_STATUS = {
  PENDING: 'pending',
  REMOVED: 'removed',
  DISMISSED: 'dismissed',
} as const;

export type AbuseStatus = (typeof ABUSE_STATUS)[keyof typeof ABUSE_STATUS];

export const UGC_UPLOAD_STATUS = {
  PENDING: 'pending',
  USED: 'used',
  DELETED: 'deleted',
} as const;

export type UgcUploadStatus = (typeof UGC_UPLOAD_STATUS)[keyof typeof UGC_UPLOAD_STATUS];

export const APP_USER_STATUS = {
  ACTIVE: 'active',
  BANNED: 'banned',
  DELETED: 'deleted',
} as const;

export type AppUserStatus = (typeof APP_USER_STATUS)[keyof typeof APP_USER_STATUS];
