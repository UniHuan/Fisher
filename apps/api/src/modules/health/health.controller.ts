import { Controller, Get } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'database unavailable');
    }
    return { status: 'ok' };
  }
}
