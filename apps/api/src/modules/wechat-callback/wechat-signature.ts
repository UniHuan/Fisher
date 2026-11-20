import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * WeChat message push URL verification uses SHA1 over the sorted token,
 * timestamp and nonce. The raw token never leaves the server.
 */
export function wechatSignature(
  token: string,
  timestamp: string,
  nonce: string,
): string {
  return createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
}

export function verifyWechatSignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string,
): boolean {
  return safeEqualHex(wechatSignature(token, timestamp, nonce), signature);
}

/**
 * Safe-mode message pushes sign the sorted token, timestamp, nonce and the
 * ciphertext, binding the signature to the exact `Encrypt` value.
 */
export function wechatMsgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  return createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
}

export function verifyWechatMsgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string,
): boolean {
  return safeEqualHex(wechatMsgSignature(token, timestamp, nonce, encrypt), signature);
}

function safeEqualHex(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
