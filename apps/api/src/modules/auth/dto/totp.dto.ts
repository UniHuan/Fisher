import { IsString, Length, Matches } from 'class-validator';

export class MfaTokenDto {
  @IsString()
  @Length(1, 128)
  mfa_token!: string;
}

export class TotpCodeDto extends MfaTokenDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class RecoveryCodeDto extends MfaTokenDto {
  @IsString()
  @Length(1, 32)
  recovery_code!: string;
}
