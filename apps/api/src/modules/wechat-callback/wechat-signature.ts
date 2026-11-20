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
  const expected = wechatSignature(token, timestamp, nonce);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
