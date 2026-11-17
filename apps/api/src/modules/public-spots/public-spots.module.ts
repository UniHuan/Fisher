import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PublicSpotsController } from './public-spots.controller';
import { PublicSpotsService } from './public-spots.service';

@Module({
  imports: [StorageModule],
  controllers: [PublicSpotsController],
  providers: [PublicSpotsService],
})
export class PublicSpotsModule {}
