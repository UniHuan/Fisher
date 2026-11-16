import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ADMIN_ROLE } from '@szfisher/shared';
import { Roles } from '../../src/common/decorators/roles.decorator';
import { AdminAuthGuard } from '../../src/common/guards/admin-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';

/**
 * Test-only route used to prove RolesGuard denies non-super admins. Registered through
 * createTestApp only; production createApp never includes it.
 */
@Controller('admin')
export class TestAdminController {
  @Post('__test__/super-only')
  @HttpCode(HttpStatus.OK)
  @Roles(ADMIN_ROLE.SUPER_ADMIN)
  @UseGuards(AdminAuthGuard, RolesGuard)
  superOnly(): { ok: true } {
    return { ok: true };
  }
}
