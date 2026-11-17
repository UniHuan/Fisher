import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from './local-storage.adapter';
import { StorageService } from './storage.service';
import { STORAGE_ADAPTER } from './storage.types';

@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const driver = config.getOrThrow<string>('STORAGE_DRIVER');
        if (driver === 'oss') {
          // Keep the Aliyun SDK out of local/test startup; it is only loaded for OSS.
          const { OssStorageAdapter } = await import('./oss-storage.adapter');
          return new OssStorageAdapter({
            region: config.getOrThrow<string>('OSS_REGION'),
            accessKeyId: config.getOrThrow<string>('OSS_ACCESS_KEY_ID'),
            accessKeySecret: config.getOrThrow<string>('OSS_ACCESS_KEY_SECRET'),
            workBucket: config.getOrThrow<string>('OSS_WORK_BUCKET'),
            publicBucket: config.getOrThrow<string>('OSS_PUBLIC_BUCKET'),
            publicBaseUrl: config.getOrThrow<string>('OSS_PUBLIC_BASE_URL'),
          });
        }
        return new LocalStorageAdapter(
          config.getOrThrow<string>('STORAGE_LOCAL_ROOT'),
          config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        );
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
