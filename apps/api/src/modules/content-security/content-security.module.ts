import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { CONTENT_SECURITY_PROVIDER } from './content-security.types';
import { WechatAccessTokenService } from './wechat-access-token.service';
import { WechatContentSecurityProvider } from './wechat-content-security.provider';

export interface ContentSecurityModuleOptions {
  /** Test-only override; production uses the real WeChat mini-program provider. */
  contentSecurityProvider?: Provider;
}

@Module({})
export class ContentSecurityModule {
  static register(options: ContentSecurityModuleOptions = {}): DynamicModule {
    return {
      module: ContentSecurityModule,
      providers: [
        WechatAccessTokenService,
        options.contentSecurityProvider ?? {
          provide: CONTENT_SECURITY_PROVIDER,
          useClass: WechatContentSecurityProvider,
        },
      ],
      exports: [CONTENT_SECURITY_PROVIDER],
    };
  }
}
