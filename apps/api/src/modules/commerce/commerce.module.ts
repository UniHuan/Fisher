import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { ClientConfigModule } from '../config/client-config.module';
import { StorageModule } from '../storage/storage.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminProductImageController } from './admin-product-image.controller';
import { AdminProductController } from './admin-product.controller';
import { PlacementService } from './placement.service';
import { ProductController } from './product.controller';
import { ProductImageService } from './product-image.service';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';
import { PurchaseActionService } from './purchase-action.service';

@Module({
  imports: [AdminAuthModule, AuditLogModule, ClientConfigModule, StorageModule, UploadsModule],
  controllers: [ProductController, AdminProductController, AdminProductImageController],
  providers: [
    ProductService,
    ProductRepository,
    PlacementService,
    ProductImageService,
    PurchaseActionService,
  ],
  exports: [ProductService, ProductRepository, PlacementService],
})
export class CommerceModule {}
