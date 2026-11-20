import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * WeChat safe-mode message push query. The strict patterns keep arbitrary
 * strings out of the signature and decrypt paths; `openid` is accepted only
 * because WeChat may include it, and is never stored or logged.
 */
export class WechatMediaCallbackQueryDto {
  @Matches(/^[a-f0-9]{40}$/)
  signature!: string;

  @Matches(/^\d{1,12}$/)
  timestamp!: string;

  @Matches(/^[A-Za-z0-9]{1,64}$/)
  nonce!: string;

  @Matches(/^[a-f0-9]{40}$/)
  msg_signature!: string;

  @IsOptional()
  @IsIn(['aes'])
  encrypt_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  openid?: string;
}

export class WechatMediaCallbackBodyDto {
  @IsString()
  @Length(1, 8192)
  Encrypt!: string;
}
