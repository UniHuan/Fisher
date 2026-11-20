import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAppUser } from '../../common/decorators/current-app-user.decorator';
import { AppAuthGuard } from '../../common/guards/app-auth.guard';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import type { AppUserContext, RequestWithContext } from '../../common/types/request-context';
import { AppAuthService, type AppMeResult, type AppSessionResult } from './app-auth.service';
import { AppMeDto } from './dto/app-me-response.dto';
import { AppSessionDto } from './dto/app-session-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@ApiTags('app auth')
@ApiClientHeaders()
@ApiCommonErrorResponses()
@Controller('auth')
export class AppAuthController {
  constructor(private readonly auth: AppAuthService) {}

  @Post('wechat/login')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(AppSessionDto)
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'Too many login attempts (42901)')
  login(
    @Body() body: WechatLoginDto,
    @Req() request: RequestWithContext,
  ): Promise<AppSessionResult> {
    return this.auth.login(body.code, request);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelopeResponse(AppSessionDto)
  refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: RequestWithContext,
  ): Promise<AppSessionResult> {
    return this.auth.refresh(body.refresh_token, request);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiEnvelopeResponse(null, { description: 'Logged out; data is null' })
  async logout(
    @Body() body: RefreshTokenDto,
    @CurrentAppUser() user: AppUserContext,
  ): Promise<null> {
    await this.auth.logout(body.refresh_token, user);
    return null;
  }

  @Get('me')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiEnvelopeResponse(AppMeDto)
  me(@CurrentAppUser() user: AppUserContext): Promise<AppMeResult> {
    return this.auth.getMe(user);
  }
}
