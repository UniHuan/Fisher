import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  ADMIN_REFRESH_COOKIE,
  clearAuthCookies,
  readCookie,
  setAuthCookies,
} from '../../common/http/admin-cookies';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiEnvelopeUnionResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import {
  type AdminProfile,
  type IssuedSession,
  type MeResult,
  AdminAuthService,
} from './admin-auth.service';
import {
  AdminSessionDto,
  LoginMfaRequiredDto,
  LoginMustBindTotpDto,
  MeDto,
  TotpEnableDto,
  TotpRecoveryDto,
  TotpSetupDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { MfaTokenDto, RecoveryCodeDto, TotpCodeDto } from './dto/totp.dto';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

interface SessionBody {
  csrf_token: string;
  admin: AdminProfile;
}

function sessionBody(session: IssuedSession): SessionBody {
  return { csrf_token: session.csrf_token, admin: session.admin };
}

@ApiTags('admin auth')
@ApiCommonErrorResponses()
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeUnionResponse(
    [AdminSessionDto, LoginMfaRequiredDto, LoginMustBindTotpDto],
    { description: 'Session issued, TOTP required, or TOTP binding required' },
  )
  async login(
    @Body() body: LoginDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody | { mfa_required: true; mfa_token: string } | { must_bind_totp: true; mfa_token: string }> {
    this.auth.assertAllowedOrigin(request, { required: true });
    const result = await this.auth.login(body, request);
    if (result.kind === 'session') {
      setAuthCookies(response, result.session);
      return sessionBody(result.session);
    }
    return result.body;
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(AdminSessionDto)
  async refresh(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody> {
    this.auth.assertAllowedOrigin(request, { required: true });
    try {
      const session = await this.auth.refresh(
        readCookie(request, ADMIN_REFRESH_COOKIE),
        request,
      );
      setAuthCookies(response, session);
      return sessionBody(session);
    } catch (error) {
      clearAuthCookies(response);
      throw error;
    }
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('admin-cookie')
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(null, { description: 'Logged out; data is null' })
  async logout(
    @CurrentAdmin() admin: AdminContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    await this.auth.logout(admin);
    clearAuthCookies(response);
    return null;
  }

  @Public()
  @Post('auth/totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(TotpSetupDto)
  async setupTotp(
    @Body() body: MfaTokenDto,
    @Req() request: RequestWithContext,
  ): Promise<{ otpauth_uri: string; manual_key: string }> {
    this.auth.assertAllowedOrigin(request, { required: true });
    return this.auth.setupTotp(body.mfa_token, request);
  }

  @Public()
  @Post('auth/totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(TotpEnableDto)
  async enableTotp(
    @Body() body: TotpCodeDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody & { recovery_codes: string[] }> {
    this.auth.assertAllowedOrigin(request, { required: true });
    const result = await this.auth.enableTotp(body.mfa_token, body.code, request);
    setAuthCookies(response, result.session);
    return { ...sessionBody(result.session), recovery_codes: result.recovery_codes };
  }

  @Public()
  @Post('auth/totp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(AdminSessionDto)
  async verifyTotp(
    @Body() body: TotpCodeDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody> {
    this.auth.assertAllowedOrigin(request, { required: true });
    const session = await this.auth.verifyTotp(body.mfa_token, body.code, request);
    setAuthCookies(response, session);
    return sessionBody(session);
  }

  @Public()
  @Post('auth/totp/recovery')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(TotpRecoveryDto)
  async recovery(
    @Body() body: RecoveryCodeDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody & { remaining_recovery_codes: number }> {
    this.auth.assertAllowedOrigin(request, { required: true });
    const result = await this.auth.loginWithRecoveryCode(
      body.mfa_token,
      body.recovery_code,
      request,
    );
    setAuthCookies(response, result.session);
    return {
      ...sessionBody(result.session),
      remaining_recovery_codes: result.remaining_recovery_codes,
    };
  }

  @Get('me')
  @ApiCookieAuth('admin-cookie')
  @ApiEnvelopeResponse(MeDto)
  async me(@CurrentAdmin() admin: AdminContext): Promise<MeResult> {
    return this.auth.getMe(admin);
  }
}
