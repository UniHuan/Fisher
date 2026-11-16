import { ApiProperty } from '@nestjs/swagger';
import { ADMIN_ROLE } from '@szfisher/shared';

export class AdminProfileDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  admin_id!: string;

  @ApiProperty({ example: 'operator01' })
  username!: string;

  @ApiProperty({ enum: Object.values(ADMIN_ROLE), example: ADMIN_ROLE.OPERATOR })
  role!: string;

  @ApiProperty({ example: true })
  totp_enabled!: boolean;
}

/** Successful login, refresh and TOTP verification session body. */
export class AdminSessionDto {
  @ApiProperty({ example: 'csrf-token-value' })
  csrf_token!: string;

  @ApiProperty({ type: () => AdminProfileDto })
  admin!: AdminProfileDto;
}

/** Login with an already-bound TOTP secret still needs the second factor. */
export class LoginMfaRequiredDto {
  @ApiProperty({ type: Boolean, enum: [true], example: true })
  mfa_required!: true;

  @ApiProperty({ example: 'mfa-token-value' })
  mfa_token!: string;
}

/** First login for a new admin must bind TOTP before a session is issued. */
export class LoginMustBindTotpDto {
  @ApiProperty({ type: Boolean, enum: [true], example: true })
  must_bind_totp!: true;

  @ApiProperty({ example: 'mfa-token-value' })
  mfa_token!: string;
}

export class TotpSetupDto {
  @ApiProperty({ example: 'otpauth://totp/SZFisher:operator01?secret=...' })
  otpauth_uri!: string;

  @ApiProperty({ example: 'JBSWY3DPEHPK3PXP' })
  manual_key!: string;
}

export class TotpEnableDto extends AdminSessionDto {
  @ApiProperty({ type: [String], example: ['AAAA-BBBB', 'CCCC-DDDD'] })
  recovery_codes!: string[];
}

export class TotpRecoveryDto extends AdminSessionDto {
  @ApiProperty({ example: 9 })
  remaining_recovery_codes!: number;
}

export class MeDto {
  @ApiProperty({ type: () => AdminProfileDto })
  admin!: AdminProfileDto;

  @ApiProperty({ type: [String], example: ['spot:read', 'audit:read'] })
  permissions!: string[];

  @ApiProperty({ example: 'csrf-token-value' })
  csrf_token!: string;
}
