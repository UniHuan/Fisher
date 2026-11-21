import { Module } from '@nestjs/common';
import { ClientConfigModule } from '../config/client-config.module';
import { StorageModule } from '../storage/storage.module';
import { PlacementService } from './placement.service';
import { ProductController } from './product.controller';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

@Module({
  imports: [ClientConfigModule, StorageModule],
  controllers: [ProductController],
  providers: [ProductService, ProductRepository, PlacementService],
  exports: [ProductService, ProductRepository, PlacementService],
})
export class CommerceModule {}
