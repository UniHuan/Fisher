import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class MfaTokenDto {
  @ApiProperty({ example: 'mfa-token-value', maxLength: 128 })
  @IsString()
  @Length(1, 128)
  mfa_token!: string;
}

export class TotpCodeDto extends MfaTokenDto {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class RecoveryCodeDto extends MfaTokenDto {
  @ApiProperty({ example: 'AAAA-BBBB', maxLength: 32 })
  @IsString()
  @Length(1, 32)
  recovery_code!: string;
}
