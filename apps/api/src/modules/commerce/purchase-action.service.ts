import { HttpStatus, Injectable } from '@nestjs/common';
import { COMMERCE_CHANNEL, ERROR_CODES, PURCHASE_ACTION_TYPE } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { V1_PURCHASE_ACTION_TYPES } from './dto/purchase-action.dto';
import type { PurchaseActionDto, PurchaseActionInputDto } from './dto/purchase-action.dto';

const V1_CHANNELS: string[] = [COMMERCE_CHANNEL.WEIDIAN];
const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/;
const MAX_PATH_LENGTH = 200;
const MAX_URL_LENGTH = 500;
const HTTPS_PREFIX = 'https://';

function validationError(message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message);
}

@Injectable()
export class PurchaseActionService {
  validate(channel: string, input: PurchaseActionInputDto): PurchaseActionDto {
    if (!V1_CHANNELS.includes(channel)) {
      throw validationError(`Unsupported commerce channel: ${channel}`);
    }
    if (!V1_PURCHASE_ACTION_TYPES.includes(input.type)) {
      throw validationError(`Unsupported purchase action type: ${input.type}`);
    }

    switch (input.type) {
      case PURCHASE_ACTION_TYPE.MINI_PROGRAM:
        return this.validateMiniProgram(input);
      case PURCHASE_ACTION_TYPE.H5:
      case PURCHASE_ACTION_TYPE.COPY_LINK:
        return this.validateUrlAction(input);
      default:
        throw validationError(`Unsupported purchase action type: ${input.type}`);
    }
  }

  private validateMiniProgram(input: PurchaseActionInputDto): PurchaseActionDto {
    const appId = input.app_id;
    if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) {
      throw validationError('app_id must be wx followed by 16 lowercase hex characters');
    }

    const path = input.path;
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw validationError('path must start with /');
    }
    if (path.length > MAX_PATH_LENGTH) {
      throw validationError(`path must be at most ${MAX_PATH_LENGTH} characters`);
    }

    const fallbackUrl = input.fallback_url;
    if (
      fallbackUrl !== undefined &&
      (typeof fallbackUrl !== 'string' || !fallbackUrl.startsWith(HTTPS_PREFIX))
    ) {
      throw validationError('fallback_url must start with https://');
    }

    const action: PurchaseActionDto = {
      type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
      app_id: appId,
      path,
    };
    if (fallbackUrl !== undefined) {
      action.fallback_url = fallbackUrl;
    }
    return action;
  }

  private validateUrlAction(input: PurchaseActionInputDto): PurchaseActionDto {
    const url = input.url;
    if (typeof url !== 'string' || !url.startsWith(HTTPS_PREFIX)) {
      throw validationError('url must start with https://');
    }
    if (url.length > MAX_URL_LENGTH) {
      throw validationError(`url must be at most ${MAX_URL_LENGTH} characters`);
    }

    const action: PurchaseActionDto = { type: input.type, url };
    if (input.type === PURCHASE_ACTION_TYPE.COPY_LINK && input.toast !== undefined) {
      action.toast = input.toast;
    }
    return action;
  }
}
