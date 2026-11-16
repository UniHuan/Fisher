import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminUsersRepository } from '../admin/admin-users.repository';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminTokenService } from './admin-token.service';
import { CsrfService } from './csrf.service';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminUsersRepository,
    AdminTokenService,
    CsrfService,
    PasswordService,
    TotpService,
    RecoveryCodeService,
    // Global guard: it only enforces /api/v1/admin and skips @Public routes.
    { provide: APP_GUARD, useClass: AdminAuthGuard },
  ],
  exports: [AdminAuthService, AdminUsersRepository, AdminTokenService, CsrfService],
})
export class AdminAuthModule {}
