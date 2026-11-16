import type { AdminRole, ClientType } from '@szfisher/shared';
import type { Request } from 'express';

export interface AdminContext {
  adminId: string;
  username: string;
  role: AdminRole;
  tokenVersion: number;
  jti: string;
}

export interface RequestWithContext extends Request {
  requestId: string;
  clientType?: ClientType;
  clientVersion?: string;
  admin?: AdminContext;
}
