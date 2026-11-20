import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { AppAuthGuard } from '../../common/guards/app-auth.guard';
import { OptionalAppAuthGuard } from '../../common/guards/optional-app-auth.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AppAuthController } from './app-auth.controller';
import { AppAuthService } from './app-auth.service';
import { AppTokenService } from './app-token.service';
import { WECHAT_AUTH_PROVIDER } from './wechat-auth.provider';
import { WechatMiniAuthProvider } from './wechat-mini-auth.provider';

export interface AppAuthModuleOptions {
  /** Test-only override; production uses the real WeChat mini-program provider. */
  wechatAuthProvider?: Provider;
}

@Module({})
export class AppAuthModule {
  static register(options: AppAuthModuleOptions = {}): DynamicModule {
    return {
      module: AppAuthModule,
      imports: [PrismaModule, RateLimitModule],
      controllers: [AppAuthController],
      providers: [
        AppAuthGuard,
        OptionalAppAuthGuard,
        AppAuthService,
        AppTokenService,
        options.wechatAuthProvider ?? {
          provide: WECHAT_AUTH_PROVIDER,
          useClass: WechatMiniAuthProvider,
        },
      ],
      exports: [AppAuthGuard, OptionalAppAuthGuard, AppAuthService, AppTokenService],
    };
  }
}
