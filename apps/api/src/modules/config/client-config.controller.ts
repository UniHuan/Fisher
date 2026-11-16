import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientConfigService, type ClientConfig } from './config.service';

@ApiTags('config')
@Controller('config')
export class ClientConfigController {
  constructor(private readonly config: ClientConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Public client configuration whitelist' })
  @ApiResponse({ status: 200, description: 'Map defaults, feature switches and freshness' })
  get(): Promise<ClientConfig> {
    return this.config.getClientConfig();
  }
}
