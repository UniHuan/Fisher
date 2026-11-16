import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminUsersRepository } from '../admin/admin-users.repository';
import { AuditLogModule } from '../audit/audit-log.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminTokenService } from './admin-token.service';
import { CsrfService } from './csrf.service';
import { LoginRateLimiter } from './login-rate-limiter.service';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [AdminAuthController],
  providers: [
    // Exported so per-controller @UseGuards can resolve both guard classes.
    AdminAuthGuard,
    RolesGuard,
    AdminAuthService,
    AdminUsersRepository,
    AdminTokenService,
    CsrfService,
    PasswordService,
    TotpService,
    RecoveryCodeService,
    LoginRateLimiter,
    // Global guard: it only enforces /api/v1/admin and skips @Public routes.
    { provide: APP_GUARD, useClass: AdminAuthGuard },
  ],
  exports: [
    AdminAuthGuard,
    RolesGuard,
    AdminAuthService,
    AdminUsersRepository,
    AdminTokenService,
    CsrfService,
    LoginRateLimiter,
  ],
})
export class AdminAuthModule {}
