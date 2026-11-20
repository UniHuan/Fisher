import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class WechatLoginDto {
  /** `wx.login` code, exchanged server-side for the caller's openid. */
  @ApiProperty({ example: '081Abc000xyz', maxLength: 512 })
  @IsString()
  @Length(1, 512)
  code!: string;
}
