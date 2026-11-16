import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { ApiCommonErrorResponses } from '../../common/openapi/api-response.decorators';
import { HealthStatusDto } from '../../common/openapi/health-status.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('public')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOkResponse({ type: HealthStatusDto, description: 'Process is alive' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthStatusDto, description: 'Database is reachable' })
  @ApiCommonErrorResponses([ERROR_CODES.DEPENDENCY_UNAVAILABLE])
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'database unavailable');
    }
    return { status: 'ok' };
  }
}
