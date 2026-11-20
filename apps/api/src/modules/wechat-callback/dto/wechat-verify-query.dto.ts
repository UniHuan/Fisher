import { Matches } from 'class-validator';

export class WechatVerifyQueryDto {
  @Matches(/^[a-f0-9]{40}$/)
  signature!: string;

  @Matches(/^\d{1,12}$/)
  timestamp!: string;

  @Matches(/^[A-Za-z0-9]{1,64}$/)
  nonce!: string;

  @Matches(/^[A-Za-z0-9]{1,512}$/)
  echostr!: string;
}
