import { Module } from '@nestjs/common';
import { WechatMediaCheckCallbackController } from './wechat-callback.controller';

@Module({
  controllers: [WechatMediaCheckCallbackController],
})
export class WechatCallbackModule {}
