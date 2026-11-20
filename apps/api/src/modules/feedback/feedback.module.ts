import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClientConfigModule } from '../config/client-config.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { StorageModule } from '../storage/storage.module';
import { UploadsModule } from '../uploads/uploads.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackImageService } from './feedback-image.service';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [PrismaModule, ClientConfigModule, RateLimitModule, StorageModule, UploadsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackRepository, FeedbackImageService],
})
export class FeedbackModule {}
