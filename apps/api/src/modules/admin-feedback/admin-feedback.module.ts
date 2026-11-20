import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { StorageModule } from '../storage/storage.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminFeedbackController } from './admin-feedback.controller';
import { AdminFeedbackRepository } from './admin-feedback.repository';
import { AdminFeedbackService } from './admin-feedback.service';

@Module({
  imports: [PrismaModule, AdminAuthModule, StorageModule, UploadsModule],
  controllers: [AdminFeedbackController],
  providers: [AdminFeedbackRepository, AdminFeedbackService],
})
export class AdminFeedbackModule {}
