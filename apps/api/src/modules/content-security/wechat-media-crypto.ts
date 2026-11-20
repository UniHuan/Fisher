import { createDecipheriv, timingSafeEqual } from 'node:crypto';
import {
  verifyWechatMsgSignature,
  verifyWechatSignature,
} from '../wechat-callback/wechat-signature';
import type {
  ContentSecuritySuggest,
  WechatMediaCallbackBody,
  WechatMediaCallbackQuery,
  WechatMediaEvent,
} from './content-security.types';

export const MAX_CALLBACK_CLOCK_SKEW_SECONDS = 10 * 60;

const HEX_SHA1 = /^[a-f0-9]{40}$/;
const TIMESTAMP = /^\d{1,12}$/;
const NONCE = /^[A-Za-z0-9]{1,64}$/;
const ENCODING_AES_KEY = /^[A-Za-z0-9+/]{43}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TRACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_EVENT = 'wxa_media_check';
const SUGGESTS: readonly ContentSecuritySuggest[] = ['pass', 'review', 'risky'];

export interface WechatMediaCryptoConfig {
  token: string;
  encodingAesKey: string;
  appid: string;
}

export interface WechatMediaVerification {
  valid: boolean;
  event?: WechatMediaEvent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * WeChat's safe-mode envelope uses PKCS#7 padding with a 32-byte block size
 * (not the AES 16-byte block), so Node's built-in auto padding must stay off.
 */
function pkcs7Unpad(buffer: Buffer): Buffer | null {
  if (buffer.length === 0 || buffer.length % 16 !== 0) {
    return null;
  }
  const pad = buffer[buffer.length - 1] ?? 0;
  if (pad < 1 || pad > 32 || pad > buffer.length) {
    return null;
  }
  for (let index = buffer.length - pad; index < buffer.length; index += 1) {
    if (buffer[index] !== pad) {
      return null;
    }
  }
  return buffer.subarray(0, buffer.length - pad);
}

function decodeAesKey(encodingAesKey: string): Buffer | null {
  if (!ENCODING_AES_KEY.test(encodingAesKey)) {
    return null;
  }
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  return key.length === 32 ? key : null;
}

/**
 * Decrypts `{Encrypt}` and validates the random(16) + length(4) + JSON + appid
 * envelope. Returns null for any malformed input; callers must not log details.
 */
function decryptEnvelope(
  encrypt: string,
  key: Buffer,
  appid: string,
): Record<string, unknown> | null {
  if (!BASE64.test(encrypt)) {
    return null;
  }
  const ciphertext = Buffer.from(encrypt, 'base64');
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    return null;
  }

  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }

  const unpadded = pkcs7Unpad(plain);
  if (unpadded === null || unpadded.length < 20) {
    return null;
  }
  const messageLength = unpadded.readUInt32BE(16);
  if (messageLength === 0 || messageLength > unpadded.length - 20) {
    return null;
  }
  const message = unpadded.subarray(20, 20 + messageLength);
  const receivedAppid = unpadded.subarray(20 + messageLength);
  if (!safeEqual(receivedAppid, Buffer.from(appid, 'utf8'))) {
    return null;
  }

  try {
    return asRecord(JSON.parse(message.toString('utf8')) as unknown);
  } catch {
    return null;
  }
}

function normalizeSuggest(value: unknown): ContentSecuritySuggest | null {
  return SUGGESTS.includes(value as ContentSecuritySuggest)
    ? (value as ContentSecuritySuggest)
    : null;
}

function readSuggest(payload: Record<string, unknown>): ContentSecuritySuggest | null {
  const result = asRecord(payload.result);
  const fromResult = normalizeSuggest(result?.suggest);
  if (fromResult !== null) {
    return fromResult;
  }
  const detail = Array.isArray(payload.detail) ? asRecord(payload.detail[0]) : null;
  return normalizeSuggest(detail?.suggest);
}

/**
 * Verifies both WeChat signatures, the timestamp window, the AES envelope and
 * the appid, then normalizes the event. Never throws and never exposes which
 * check failed to the caller.
 */
export function verifyWechatMediaCallback(
  config: WechatMediaCryptoConfig,
  query: WechatMediaCallbackQuery,
  body: WechatMediaCallbackBody,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WechatMediaVerification {
  if (
    config.token.length === 0 ||
    config.appid.length === 0 ||
    config.encodingAesKey.length === 0
  ) {
    return { valid: false };
  }
  if (
    !HEX_SHA1.test(query.signature) ||
    !HEX_SHA1.test(query.msg_signature) ||
    !TIMESTAMP.test(query.timestamp) ||
    !NONCE.test(query.nonce) ||
    typeof body.Encrypt !== 'string' ||
    body.Encrypt.length === 0
  ) {
    return { valid: false };
  }
  const timestampSeconds = Number(query.timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CALLBACK_CLOCK_SKEW_SECONDS
  ) {
    return { valid: false };
  }
  if (
    !verifyWechatSignature(config.token, query.timestamp, query.nonce, query.signature) ||
    !verifyWechatMsgSignature(
      config.token,
      query.timestamp,
      query.nonce,
      body.Encrypt,
      query.msg_signature,
    )
  ) {
    return { valid: false };
  }

  const key = decodeAesKey(config.encodingAesKey);
  if (key === null) {
    return { valid: false };
  }
  const payload = decryptEnvelope(body.Encrypt, key, config.appid);
  if (payload === null) {
    return { valid: false };
  }
  if (payload.Event !== MEDIA_EVENT) {
    return { valid: false };
  }
  if (typeof payload.appid === 'string' && payload.appid !== config.appid) {
    return { valid: false };
  }
  const traceId = payload.trace_id;
  if (typeof traceId !== 'string' || !TRACE_ID.test(traceId)) {
    return { valid: false };
  }

  const errcode = typeof payload.errcode === 'number' ? payload.errcode : 0;
  const suggest = readSuggest(payload);
  const labelValue = asRecord(payload.result)?.label;
  const event: WechatMediaEvent = {
    traceId,
    suggest: suggest ?? 'review',
    ...(typeof labelValue === 'number' && Number.isFinite(labelValue)
      ? { label: labelValue }
      : {}),
    ...(errcode !== 0
      ? { errorCode: `errcode-${errcode}` }
      : suggest === null
        ? { errorCode: 'missing-suggest' }
        : {}),
  };
  return { valid: true, event };
}
