import type { AdminRole, ClientType } from '@szfisher/shared';
import type { Request } from 'express';

export interface AdminContext {
  adminId: string;
  username: string;
  role: AdminRole;
  tokenVersion: number;
  jti: string;
}

export interface AppUserContext {
  userId: string;
  openid: string;
  nickname: string | null;
  status: string;
  tokenVersion: number;
}

export interface RequestWithContext extends Request {
  requestId: string;
  clientType?: ClientType;
  clientVersion?: string;
  admin?: AdminContext;
  appUser?: AppUserContext;
}
