import type { AdminRole, ClientType } from '@szfisher/shared';
import type { Request } from 'express';

export interface AdminContext {
  adminId: string;
  role: AdminRole;
}

export interface RequestWithContext extends Request {
  requestId: string;
  clientType?: ClientType;
  clientVersion?: string;
  admin?: AdminContext;
}
