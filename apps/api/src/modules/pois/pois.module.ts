import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { POI_PROVIDER } from './poi.provider';
import { PoisController } from './pois.controller';
import { PoisRepository } from './pois.repository';
import { PoisService } from './pois.service';
import { SpotPoiDistancesService } from './spot-poi-distances.service';
import { TencentPoiProvider } from './tencent-poi.provider';

@Module({
  imports: [AdminAuthModule, AuditLogModule],
  controllers: [PoisController],
  providers: [
    PoisRepository,
    PoisService,
    SpotPoiDistancesService,
    TencentPoiProvider,
    { provide: POI_PROVIDER, useExisting: TencentPoiProvider },
  ],
  // Spot edits also refresh stored POI distances.
  exports: [SpotPoiDistancesService],
})
export class PoisModule {}
